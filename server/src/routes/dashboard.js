import { Router } from 'express';
import { q, one } from '../db.js';
import { HttpError, todayStr, nowStr, PUNCH_MATCH, likeTerm } from '../util.js';
import { visibleCond } from '../services/approvals.js';
import { buildWorkbook, sendXlsx } from '../services/sheet.js';

/**
 * Dashboard figures for a date range (by gate pass date).
 *  scope=plant – everyone's gate passes (admin, security admin, security logins)
 *  scope=me    – the signed-in employee's own passes, and the requests they approve
 */
const r = Router();
const PLANT_ROLES = ['admin', 'security_admin', 'security'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function range(query) {
  const to = DATE_RE.test(query.to || '') ? query.to : todayStr();
  const from = DATE_RE.test(query.from || '') ? query.from : to;
  if (from > to) throw new HttpError(400, '"From" date must be before "To" date');
  const days = (Date.parse(to) - Date.parse(from)) / 864e5;
  if (days > 731) throw new HttpError(400, 'Choose a range of up to 2 years');
  return { from, to };
}

function dayList(from, to) {
  const out = [];
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 864e5) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

const n = (v) => Number(v || 0);

async function passStats(where, params, { from, to }) {
  const W = `g.pass_date BETWEEN ? AND ? ${where ? `AND ${where}` : ''}`;
  const P = [from, to, ...params];
  const k = await one(
    `SELECT COUNT(*) requests, SUM(g.status='approved') approved, SUM(g.status='rejected') rejected, SUM(g.status='pending') pending,
            SUM(g.status='cancelled') cancelled, SUM(g.actual_out IS NOT NULL) checked_out, SUM(g.gate_status='returned') returned,
            SUM(g.nr_status IS NOT NULL AND g.nr_status<>'returned_late') not_returned,
            SUM(g.status='approved' AND g.coming_back=0) not_coming_back, COUNT(DISTINCT g.user_id) people,
            ROUND(AVG(CASE WHEN g.decided_at IS NOT NULL AND g.status IN ('approved','rejected') THEN TIMESTAMPDIFF(MINUTE, g.created_at, g.decided_at) END)) avg_decision_min,
            ROUND(AVG(CASE WHEN g.actual_in IS NOT NULL THEN TIMESTAMPDIFF(MINUTE, g.actual_out, g.actual_in) END)) avg_out_min
       FROM gate_passes g WHERE ${W}`,
    P
  );
  const daily = await q(
    `SELECT DATE_FORMAT(g.pass_date,'%Y-%m-%d') d, COUNT(*) requests, SUM(g.status='approved') approved, SUM(g.status='rejected') rejected,
            SUM(g.status='pending') pending, SUM(g.status='cancelled') cancelled, SUM(g.actual_out IS NOT NULL) checked_out
       FROM gate_passes g WHERE ${W} GROUP BY g.pass_date`,
    P
  );
  const byDay = new Map(daily.map((x) => [x.d, x]));
  const purpose = await q(
    `SELECT CASE WHEN g.reason_type IN ('Official Purpose','Personal Purpose') THEN g.reason_type ELSE 'Other (older requests)' END purpose,
            COUNT(*) requests, SUM(g.status='approved') approved
       FROM gate_passes g WHERE ${W} GROUP BY purpose ORDER BY requests DESC`,
    P
  );
  const hours = await q(
    `SELECT HOUR(g.actual_out) h, COUNT(*) c FROM gate_passes g WHERE ${W} AND g.actual_out IS NOT NULL GROUP BY h`,
    P
  );
  const hourMap = new Map(hours.map((x) => [x.h, n(x.c)]));
  return {
    kpis: Object.fromEntries(Object.entries(k).map(([key, v]) => [key, v === null ? null : n(v)])),
    daily: dayList(from, to).map((d) => {
      const x = byDay.get(d) || {};
      return { date: d, requests: n(x.requests), approved: n(x.approved), rejected: n(x.rejected), pending: n(x.pending), cancelled: n(x.cancelled), checked_out: n(x.checked_out) };
    }),
    purpose: purpose.map((x) => ({ purpose: x.purpose, requests: n(x.requests), approved: n(x.approved) })),
    checkoutsByHour: Array.from({ length: 24 }, (_, h) => ({ hour: h, checkouts: hourMap.get(h) || 0 })),
  };
}

r.get('/', async (req, res) => {
  res.json(await build(req));
});

async function build(req) {
  const scope = req.query.scope === 'plant' ? 'plant' : 'me';
  if (scope === 'plant' && !PLANT_ROLES.includes(req.user.role)) throw new HttpError(403, 'You do not have access to the plant dashboard');
  const rg = range(req.query);
  const out = { scope, ...rg, generatedAt: nowStr() };

  if (scope === 'plant') {
    Object.assign(out, await passStats('', [], rg));
    out.departments = (await q(
      `SELECT COALESCE(NULLIF(g.department,''),'(none)') department, COUNT(*) requests, SUM(g.status='approved') approved, SUM(g.status='rejected') rejected
         FROM gate_passes g WHERE g.pass_date BETWEEN ? AND ? GROUP BY department ORDER BY requests DESC LIMIT 12`,
      [rg.from, rg.to]
    )).map((x) => ({ department: x.department, requests: n(x.requests), approved: n(x.approved), rejected: n(x.rejected) }));
    out.topEmployees = (await q(
      `SELECT g.emp_name name, g.emp_code, g.department, COUNT(*) requests, SUM(g.status='approved') approved,
              SUM(g.nr_status IS NOT NULL AND g.nr_status<>'returned_late') not_returned
         FROM gate_passes g WHERE g.pass_date BETWEEN ? AND ? GROUP BY g.user_id, g.emp_name, g.emp_code, g.department ORDER BY requests DESC LIMIT 10`,
      [rg.from, rg.to]
    )).map((x) => ({ ...x, requests: n(x.requests), approved: n(x.approved), not_returned: n(x.not_returned) }));
    // right now (not tied to the range)
    const today = todayStr();
    out.now = {
      employees: n((await one(`SELECT COUNT(*) c FROM users WHERE is_deleted=0 AND is_active=1 AND role<>'security'`)).c),
      presentToday: n((await one(
        `SELECT COUNT(DISTINCT u.id) c FROM users u JOIN attendance_punches p ON ${PUNCH_MATCH('u', 'p')}
          WHERE u.is_deleted=0 AND u.is_active=1 AND u.role<>'security' AND p.punch_time >= ?`,
        [today + ' 00:00:00']
      )).c),
      outNow: n((await one(`SELECT COUNT(*) c FROM gate_passes WHERE status='approved' AND gate_status='out'`)).c),
      awaitingCheckout: n((await one(`SELECT COUNT(*) c FROM gate_passes WHERE status='approved' AND gate_status='not_left' AND pass_date=?`, [today])).c),
      pendingApproval: n((await one(`SELECT COUNT(*) c FROM gate_passes WHERE status='pending'`)).c),
      notReturnedOpen: n((await one(`SELECT COUNT(*) c FROM gate_passes WHERE gate_status='out' AND nr_status IN ('awaiting_reason','reason_submitted')`)).c),
    };
    return out;
  }

  // my own gate passes
  out.mine = await passStats('g.user_id=?', [req.user.id], rg);
  // the requests I approve
  const isApprover = (await one(`SELECT COUNT(*) c FROM pass_approvers WHERE approver_id=?`, [req.user.id])).c > 0 ||
    (await one(`SELECT COUNT(*) c FROM authorities WHERE primary_id=? OR secondary_id=? OR third_id=?`, [req.user.id, req.user.id, req.user.id])).c > 0;
  if (isApprover) {
    const vis = await visibleCond();
    const k = await one(
      `SELECT SUM(g.decided_by=? AND g.status='approved') approved_by_me, SUM(g.decided_by=? AND g.status='rejected') rejected_by_me,
              SUM(g.status IN ('approved','rejected') AND g.decided_by<>?) decided_by_others,
              ROUND(AVG(CASE WHEN g.decided_by=? THEN TIMESTAMPDIFF(MINUTE, COALESCE(pa.notified_at, g.created_at), g.decided_at) END)) avg_response_min,
              SUM(g.nr_decided_by=?) not_returned_reviewed
         FROM pass_approvers pa JOIN gate_passes g ON g.id=pa.pass_id
        WHERE pa.approver_id=? AND g.pass_date BETWEEN ? AND ?`,
      [req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, rg.from, rg.to]
    );
    const daily = await q(
      `SELECT DATE_FORMAT(g.pass_date,'%Y-%m-%d') d, SUM(g.decided_by=? AND g.status='approved') approved, SUM(g.decided_by=? AND g.status='rejected') rejected
         FROM pass_approvers pa JOIN gate_passes g ON g.id=pa.pass_id WHERE pa.approver_id=? AND g.pass_date BETWEEN ? AND ? GROUP BY g.pass_date`,
      [req.user.id, req.user.id, req.user.id, rg.from, rg.to]
    );
    const byDay = new Map(daily.map((x) => [x.d, x]));
    out.approvals = {
      kpis: {
        ...Object.fromEntries(Object.entries(k).map(([key, v]) => [key, v === null ? null : n(v)])),
        pending_now: n((await one(
          `SELECT COUNT(*) c FROM pass_approvers pa JOIN gate_passes g ON g.id=pa.pass_id WHERE pa.approver_id=? AND g.status='pending' AND ${vis.sql}`,
          [req.user.id, ...vis.params]
        )).c),
      },
      daily: dayList(rg.from, rg.to).map((d) => ({ date: d, approved: n(byDay.get(d)?.approved), rejected: n(byDay.get(d)?.rejected) })),
      team: (await q(
        `SELECT g.emp_name name, g.emp_code, COUNT(*) requests, SUM(g.status='approved') approved
           FROM pass_approvers pa JOIN gate_passes g ON g.id=pa.pass_id WHERE pa.approver_id=? AND g.pass_date BETWEEN ? AND ?
          GROUP BY g.user_id, g.emp_name, g.emp_code ORDER BY requests DESC LIMIT 10`,
        [req.user.id, rg.from, rg.to]
      )).map((x) => ({ ...x, requests: n(x.requests), approved: n(x.approved) })),
    };
  }
  return out;
}

/**
 * Gate passes raised per person in a date range (plant view): every active employee, with
 * search, department filter and paging. format=xlsx downloads the whole filtered list.
 */
r.get('/people', async (req, res) => {
  if (!PLANT_ROLES.includes(req.user.role)) throw new HttpError(403, 'You do not have access to this list');
  const rg = range(req.query);
  const where = [`u.is_deleted=0 AND u.role<>'security'`];
  const params = [];
  if (req.query.search) {
    const t = likeTerm(req.query.search);
    where.push('(u.name LIKE ? OR u.emp_code LIKE ? OR u.department LIKE ?)');
    params.push(t, t, t);
  }
  if (req.query.department) {
    where.push('u.department=?');
    params.push(req.query.department);
  }
  if (req.query.only === 'raised') where.push('COALESCE(x.raised,0)>0');
  else if (req.query.only !== 'all') where.push('(u.is_active=1 OR COALESCE(x.raised,0)>0)');
  const from = `FROM users u
    LEFT JOIN (
      SELECT g.user_id, COUNT(*) raised, SUM(g.status='approved') approved, SUM(g.status='rejected') rejected,
             SUM(g.status='pending') pending, SUM(g.status='cancelled') cancelled, SUM(g.reason_type='Official Purpose') official,
             SUM(g.reason_type='Personal Purpose') personal, SUM(g.nr_status IS NOT NULL AND g.nr_status<>'returned_late') not_returned,
             MAX(g.pass_date) last_date
        FROM gate_passes g WHERE g.pass_date BETWEEN ? AND ? GROUP BY g.user_id
    ) x ON x.user_id=u.id
    WHERE ${where.join(' AND ')}`;
  const P = [rg.from, rg.to, ...params];
  const SORTS = { raised: 'raised DESC, u.name', name: 'u.name', department: 'u.department, u.name' };
  const order = SORTS[req.query.sort] || SORTS.raised;
  const cols = `u.id, u.emp_code, u.name, u.department, u.is_active, COALESCE(x.raised,0) raised, COALESCE(x.approved,0) approved,
    COALESCE(x.rejected,0) rejected, COALESCE(x.pending,0) pending, COALESCE(x.cancelled,0) cancelled, COALESCE(x.official,0) official,
    COALESCE(x.personal,0) personal, COALESCE(x.not_returned,0) not_returned, DATE_FORMAT(x.last_date,'%Y-%m-%d') last_date`;
  const tot = await one(`SELECT COUNT(*) c, SUM(COALESCE(x.raised,0)) raised, SUM(COALESCE(x.raised,0)>0) people_raised ${from}`, P);
  if (req.query.format === 'xlsx') {
    const rows = await q(`SELECT ${cols} ${from} ORDER BY ${order}`, P);
    const head = ['Employee', 'Employee ID', 'Department', 'Gate passes raised', 'Official', 'Personal', 'Approved', 'Rejected', 'Pending', 'Cancelled', 'Did not return', 'Last gate pass'];
    return sendXlsx(
      res,
      `gatepass-per-person-${rg.from}-to-${rg.to}.xlsx`,
      buildWorkbook([{ name: 'Per person', widths: [26, 12, 18, 12, 10, 10, 10, 10, 10, 10, 12, 14], rows: [[`Gate passes per person, ${rg.from} to ${rg.to}`], [], head, ...rows.map((x) => [x.name, x.emp_code, x.department || '', n(x.raised), n(x.official), n(x.personal), n(x.approved), n(x.rejected), n(x.pending), n(x.cancelled), n(x.not_returned), x.last_date || ''])] }])
    );
  }
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(5, parseInt(req.query.pageSize, 10) || 10));
  const rows = await q(`SELECT ${cols} ${from} ORDER BY ${order} LIMIT ? OFFSET ?`, [...P, pageSize, (page - 1) * pageSize]);
  res.json({
    from: rg.from,
    to: rg.to,
    total: n(tot.c),
    totals: { raised: n(tot.raised), peopleRaised: n(tot.people_raised) },
    page,
    pageSize,
    rows: rows.map((x) => ({ ...x, raised: n(x.raised), approved: n(x.approved), rejected: n(x.rejected), pending: n(x.pending), cancelled: n(x.cancelled), official: n(x.official), personal: n(x.personal), not_returned: n(x.not_returned) })),
  });
});

/** The same figures as an Excel workbook, one sheet per chart. */
r.get('/export', async (req, res) => {
  const d = await build(req);
  const sheets = [];
  const kpiRows = (obj) => Object.entries(obj || {}).map(([k, v]) => [k.replace(/_/g, ' '), v ?? '']);
  const title = `${d.scope === 'plant' ? 'Plant' : 'My'} gate pass dashboard, ${d.from} to ${d.to}`;
  if (d.scope === 'plant') {
    sheets.push({ name: 'Summary', widths: [30, 14], rows: [[title], [], ['Measure', 'Value'], ...kpiRows(d.kpis), [], ['Right now', ''], ...kpiRows(d.now)] });
    sheets.push({ name: 'By day', widths: [12, 10, 10, 10, 10, 10, 12], rows: [['Date', 'Requests', 'Approved', 'Rejected', 'Pending', 'Cancelled', 'Checked out'], ...d.daily.map((x) => [x.date, x.requests, x.approved, x.rejected, x.pending, x.cancelled, x.checked_out])] });
    sheets.push({ name: 'By purpose', widths: [24, 10, 10], rows: [['Purpose', 'Requests', 'Approved'], ...d.purpose.map((x) => [x.purpose, x.requests, x.approved])] });
    sheets.push({ name: 'By department', widths: [24, 10, 10, 10], rows: [['Department', 'Requests', 'Approved', 'Rejected'], ...d.departments.map((x) => [x.department, x.requests, x.approved, x.rejected])] });
    sheets.push({ name: 'Check-outs by hour', widths: [10, 12], rows: [['Hour', 'Check-outs'], ...d.checkoutsByHour.map((x) => [`${String(x.hour).padStart(2, '0')}:00`, x.checkouts])] });
    sheets.push({ name: 'Top employees', widths: [24, 12, 18, 10, 10, 14], rows: [['Employee', 'Employee ID', 'Department', 'Requests', 'Approved', 'Not returned'], ...d.topEmployees.map((x) => [x.name, x.emp_code, x.department, x.requests, x.approved, x.not_returned])] });
  } else {
    sheets.push({ name: 'My summary', widths: [30, 14], rows: [[title], [], ['Measure', 'Value'], ...kpiRows(d.mine.kpis)] });
    sheets.push({ name: 'My requests by day', widths: [12, 10, 10, 10, 10], rows: [['Date', 'Requests', 'Approved', 'Rejected', 'Pending'], ...d.mine.daily.map((x) => [x.date, x.requests, x.approved, x.rejected, x.pending])] });
    sheets.push({ name: 'My purposes', widths: [24, 10, 10], rows: [['Purpose', 'Requests', 'Approved'], ...d.mine.purpose.map((x) => [x.purpose, x.requests, x.approved])] });
    if (d.approvals) {
      sheets.push({ name: 'My approvals', widths: [30, 14], rows: [['Measure', 'Value'], ...kpiRows(d.approvals.kpis)] });
      sheets.push({ name: 'Approvals by day', widths: [12, 10, 10], rows: [['Date', 'Approved by me', 'Rejected by me'], ...d.approvals.daily.map((x) => [x.date, x.approved, x.rejected])] });
      sheets.push({ name: 'My team', widths: [24, 12, 10, 10], rows: [['Employee', 'Employee ID', 'Requests', 'Approved'], ...d.approvals.team.map((x) => [x.name, x.emp_code, x.requests, x.approved])] });
    }
  }
  sendXlsx(res, `gatepass-dashboard-${d.scope}-${d.from}-to-${d.to}.xlsx`, buildWorkbook(sheets));
});

export default r;
