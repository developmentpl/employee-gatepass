import { Router } from 'express';
import { q, one, tx } from '../db.js';
import { HttpError, paging, clean, likeTerm, nowStr, todayStr, REASON_TYPES } from '../util.js';
import { requireRole } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { sendMail, passSummaryHtml } from '../services/mailer.js';
import { sendCsv } from '../services/csv.js';

const r = Router();

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const LEVEL_LABEL = { primary: 'Primary', secondary: 'Secondary', third: 'Third' };

const PASS_COLS = `g.id, g.pass_no, g.user_id, g.emp_code, g.emp_name, g.department, g.shift, g.pass_date,
  g.reason_type, g.reason, g.out_time, g.coming_back, g.expected_in_time, g.status, g.decided_by, g.decided_by_name,
  g.decided_level, g.decided_at, g.decision_remark, g.gate_status, g.actual_out, g.actual_in, g.out_marked_by,
  g.in_marked_by, g.created_at`;

/* ---------------- employee: my requests ---------------- */

r.get('/mine', async (req, res) => {
  const { page, pageSize, offset } = paging(req.query, 10);
  const where = ['g.user_id=?'];
  const params = [req.user.id];
  if (req.query.status) {
    where.push('g.status=?');
    params.push(req.query.status);
  }
  const w = where.join(' AND ');
  const total = (await one(`SELECT COUNT(*) c FROM gate_passes g WHERE ${w}`, params)).c;
  const rows = await q(`SELECT ${PASS_COLS} FROM gate_passes g WHERE ${w} ORDER BY g.id DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  res.json({ rows, total, page, pageSize });
});

r.post('/', async (req, res) => {
  const u = req.user;
  const b = req.body || {};
  const pass_date = clean(b.pass_date) || todayStr();
  const reason_type = clean(b.reason_type);
  const reason = clean(b.reason);
  const out_time = clean(b.out_time);
  const coming_back = b.coming_back === true || b.coming_back === 'true' || b.coming_back === 1 || b.coming_back === '1';
  const expected_in_time = coming_back ? clean(b.expected_in_time) : null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(pass_date)) throw new HttpError(400, 'Date is not valid');
  if (pass_date < todayStr()) throw new HttpError(400, 'Gate pass date cannot be in the past');
  const max = new Date();
  max.setDate(max.getDate() + 30);
  if (pass_date > todayStr(max)) throw new HttpError(400, 'Gate pass can be raised at most 30 days in advance');
  if (!REASON_TYPES.includes(reason_type)) throw new HttpError(400, 'Select a reason for going out');
  if (!reason) throw new HttpError(400, 'Describe the reason for going out');
  if (reason.length > 500) throw new HttpError(400, 'Reason must be under 500 characters');
  if (!TIME_RE.test(out_time)) throw new HttpError(400, 'Enter out time');
  if (coming_back) {
    if (!TIME_RE.test(expected_in_time || '')) throw new HttpError(400, 'Enter expected time of arrival');
    if (expected_in_time <= out_time) throw new HttpError(400, 'Expected arrival must be after out time');
  }

  const auth = await one(
    `SELECT a.primary_id, a.secondary_id, a.third_id FROM authorities a WHERE a.user_id=?`,
    [u.id]
  );
  if (!auth) throw new HttpError(400, 'No approving authority is assigned to you yet. Please contact the administrator.');
  const approverRows = await q(
    `SELECT id, name, email FROM users WHERE id IN (?) AND is_active=1 AND is_deleted=0`,
    [[auth.primary_id, auth.secondary_id, auth.third_id].filter(Boolean)]
  );
  const activeIds = new Set(approverRows.map((x) => x.id));
  const approvers = [
    ['primary', auth.primary_id],
    ['secondary', auth.secondary_id],
    ['third', auth.third_id],
  ].filter(([, id]) => id && activeIds.has(id));
  if (!approvers.length) throw new HttpError(400, 'Your assigned authorities are inactive. Please contact the administrator.');

  const pass = await tx(async (run) => {
    const ins = await run(
      `INSERT INTO gate_passes (user_id, emp_code, emp_name, department, shift, pass_date, reason_type, reason, out_time, coming_back, expected_in_time, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [u.id, u.emp_code, u.name, u.department, u.shift, pass_date, reason_type, reason, out_time, coming_back ? 1 : 0, expected_in_time, nowStr()]
    );
    const id = ins.insertId;
    const passNo = `GP-${pass_date.replace(/-/g, '').slice(2)}-${String(id).padStart(5, '0')}`;
    await run(`UPDATE gate_passes SET pass_no=? WHERE id=?`, [passNo, id]);
    for (const [level, aid] of approvers) {
      await run(`INSERT INTO pass_approvers (pass_id, approver_id, level) VALUES (?,?,?)`, [id, aid, level]);
    }
    return (await run(`SELECT ${PASS_COLS} FROM gate_passes g WHERE g.id=?`, [id]))[0];
  });

  await audit(req, {
    module: 'gatepass',
    action: 'requested',
    entityId: pass.pass_no,
    description: `${u.name} (${u.emp_code}) requested gate pass ${pass.pass_no} – ${reason_type}, out ${out_time}${coming_back ? `, back by ${expected_in_time}` : ', not returning'}`,
  });
  sendMail(
    approverRows.map((x) => x.email),
    `Gate pass approval needed: ${u.name} (${pass.pass_no})`,
    passSummaryHtml(pass, `${u.name} has requested a gate pass and is waiting for your approval.`)
  );
  res.status(201).json(pass);
});

r.post('/:id/cancel', async (req, res) => {
  const p = await one(`SELECT * FROM gate_passes WHERE id=?`, [req.params.id]);
  if (!p || p.user_id !== req.user.id) throw new HttpError(404, 'Request not found');
  const upd = await q(`UPDATE gate_passes SET status='cancelled', decided_at=? WHERE id=? AND status='pending'`, [nowStr(), p.id]);
  if (!upd.affectedRows) throw new HttpError(409, 'Only pending requests can be cancelled');
  await audit(req, { module: 'gatepass', action: 'cancelled', entityId: p.pass_no, description: `${req.user.name} cancelled gate pass ${p.pass_no}` });
  res.json({ ok: true });
});

/* ---------------- authority: approvals ---------------- */

r.get('/approvals', async (req, res) => {
  const { page, pageSize, offset } = paging(req.query, 10);
  const where = ['pa.approver_id=?'];
  const params = [req.user.id];
  if (req.query.tab === 'completed') where.push(`g.status<>'pending'`);
  else where.push(`g.status='pending'`);
  if (req.query.search) {
    const t = likeTerm(req.query.search);
    where.push('(g.emp_name LIKE ? OR g.emp_code LIKE ? OR g.pass_no LIKE ? OR g.reason LIKE ?)');
    params.push(t, t, t, t);
  }
  if (req.query.from) {
    where.push('g.pass_date>=?');
    params.push(req.query.from);
  }
  if (req.query.to) {
    where.push('g.pass_date<=?');
    params.push(req.query.to);
  }
  const w = where.join(' AND ');
  const base = `FROM pass_approvers pa JOIN gate_passes g ON g.id=pa.pass_id LEFT JOIN users u ON u.id=g.user_id WHERE ${w}`;
  const total = (await one(`SELECT COUNT(*) c ${base}`, params)).c;
  const order = req.query.tab === 'completed' ? 'g.decided_at DESC, g.id DESC' : 'g.pass_date ASC, g.out_time ASC';
  const rows = await q(`SELECT ${PASS_COLS}, pa.level my_level, u.photo ${base} ORDER BY ${order} LIMIT ? OFFSET ?`, [
    ...params,
    pageSize,
    offset,
  ]);
  res.json({ rows, total, page, pageSize });
});

r.post('/:id/decision', async (req, res) => {
  const id = Number(req.params.id);
  const decision = req.body?.decision;
  const remark = clean(req.body?.remark).slice(0, 500);
  if (!['approved', 'rejected'].includes(decision)) throw new HttpError(400, 'Invalid decision');
  if (decision === 'rejected' && !remark) throw new HttpError(400, 'Please give a reason for rejection');

  const p = await one(`SELECT * FROM gate_passes WHERE id=?`, [id]);
  if (!p) throw new HttpError(404, 'Request not found');
  const mine = await one(`SELECT level FROM pass_approvers WHERE pass_id=? AND approver_id=?`, [id, req.user.id]);
  const isAdmin = req.user.role === 'admin';
  if (!mine && !isAdmin) throw new HttpError(403, 'You are not an authority for this request');
  if (p.user_id === req.user.id) throw new HttpError(403, 'You cannot approve your own request');
  const level = mine ? mine.level : 'admin';

  const upd = await q(
    `UPDATE gate_passes SET status=?, decided_by=?, decided_by_name=?, decided_level=?, decided_at=?, decision_remark=?
      WHERE id=? AND status='pending'`,
    [decision, req.user.id, req.user.name, level, nowStr(), remark || null, id]
  );
  if (!upd.affectedRows) {
    const cur = await one(`SELECT status, decided_by_name FROM gate_passes WHERE id=?`, [id]);
    throw new HttpError(409, cur.status === 'cancelled'
      ? 'This request was cancelled by the employee'
      : `This request was already ${cur.status} by ${cur.decided_by_name || 'another authority'}`);
  }
  const fresh = await one(`SELECT ${PASS_COLS} FROM gate_passes g WHERE g.id=?`, [id]);
  await audit(req, {
    module: 'gatepass',
    action: decision,
    entityId: p.pass_no,
    description: `${req.user.name} (${level === 'admin' ? 'Admin' : LEVEL_LABEL[level] + ' authority'}) ${decision} gate pass ${p.pass_no} of ${p.emp_name}${remark ? ` – "${remark}"` : ''}`,
  });
  const requester = await one(`SELECT email FROM users WHERE id=?`, [p.user_id]);
  sendMail(
    requester?.email,
    `Your gate pass ${p.pass_no} was ${decision}`,
    passSummaryHtml(fresh, `Your gate pass request was <b>${decision}</b> by ${req.user.name}.`)
  );
  res.json(fresh);
});

/* ---------------- admin: all requests ---------------- */

r.get('/all', requireRole('admin'), async (req, res) => {
  const { page, pageSize, offset } = paging(req.query);
  const where = ['1=1'];
  const params = [];
  if (req.query.tab === 'pending') where.push(`g.status='pending'`);
  if (req.query.tab === 'completed') where.push(`g.status<>'pending'`);
  if (req.query.status) {
    where.push('g.status=?');
    params.push(req.query.status);
  }
  if (req.query.department) {
    where.push('g.department=?');
    params.push(req.query.department);
  }
  if (req.query.from) {
    where.push('g.pass_date>=?');
    params.push(req.query.from);
  }
  if (req.query.to) {
    where.push('g.pass_date<=?');
    params.push(req.query.to);
  }
  if (req.query.search) {
    const t = likeTerm(req.query.search);
    where.push('(g.emp_name LIKE ? OR g.emp_code LIKE ? OR g.pass_no LIKE ? OR g.reason LIKE ? OR g.decided_by_name LIKE ?)');
    params.push(t, t, t, t, t);
  }
  const w = where.join(' AND ');
  const approversSub = `(SELECT GROUP_CONCAT(CONCAT(x.name) ORDER BY FIELD(pa.level,'primary','secondary','third') SEPARATOR ', ')
                          FROM pass_approvers pa JOIN users x ON x.id=pa.approver_id WHERE pa.pass_id=g.id)`;
  if (req.query.format === 'csv') {
    const rows = await q(`SELECT ${PASS_COLS}, ${approversSub} approvers FROM gate_passes g WHERE ${w} ORDER BY g.id DESC LIMIT 50000`, params);
    return sendCsv(res, `gate-passes-${todayStr()}.csv`, [
      { label: 'Pass No', key: 'pass_no' },
      { label: 'Date', key: 'pass_date' },
      { label: 'Employee ID', key: 'emp_code' },
      { label: 'Employee Name', key: 'emp_name' },
      { label: 'Department', key: 'department' },
      { label: 'Shift', key: 'shift' },
      { label: 'Reason Type', key: 'reason_type' },
      { label: 'Reason', key: 'reason' },
      { label: 'Out Time', value: (r) => String(r.out_time || '').slice(0, 5) },
      { label: 'Coming Back', value: (r) => (r.coming_back ? 'Yes' : 'No') },
      { label: 'Expected In', value: (r) => String(r.expected_in_time || '').slice(0, 5) },
      { label: 'Authorities', key: 'approvers' },
      { label: 'Status', key: 'status' },
      { label: 'Decided By', key: 'decided_by_name' },
      { label: 'Decided At', key: 'decided_at' },
      { label: 'Remark', key: 'decision_remark' },
      { label: 'Actual Out', key: 'actual_out' },
      { label: 'Actual In', key: 'actual_in' },
      { label: 'Requested At', key: 'created_at' },
    ], rows);
  }
  const total = (await one(`SELECT COUNT(*) c FROM gate_passes g WHERE ${w}`, params)).c;
  const order = req.query.tab === 'pending' ? 'g.pass_date ASC, g.out_time ASC' : 'g.id DESC';
  const rows = await q(
    `SELECT ${PASS_COLS}, ${approversSub} approvers FROM gate_passes g WHERE ${w} ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  res.json({ rows, total, page, pageSize });
});

/* ---------------- security: gate desk ---------------- */

r.get('/gate/list', requireRole('security', 'admin'), async (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : todayStr();
  const where = [`g.status='approved'`, 'g.pass_date=?'];
  const params = [date];
  if (req.query.state && ['not_left', 'out', 'returned'].includes(req.query.state)) {
    where.push('g.gate_status=?');
    params.push(req.query.state);
  }
  if (req.query.search) {
    const t = likeTerm(req.query.search);
    where.push('(g.emp_name LIKE ? OR g.emp_code LIKE ? OR g.pass_no LIKE ?)');
    params.push(t, t, t);
  }
  const rows = await q(
    `SELECT ${PASS_COLS}, u.photo FROM gate_passes g LEFT JOIN users u ON u.id=g.user_id
      WHERE ${where.join(' AND ')} ORDER BY FIELD(g.gate_status,'out','not_left','returned'), g.out_time LIMIT 500`,
    params
  );
  res.json({ rows, date });
});

r.post('/gate/:id/:action', requireRole('security', 'admin'), async (req, res) => {
  const { action } = req.params;
  if (!['out', 'in'].includes(action)) throw new HttpError(404, 'Unknown action');
  const p = await one(`SELECT * FROM gate_passes WHERE id=?`, [req.params.id]);
  if (!p || p.status !== 'approved') throw new HttpError(400, 'Only approved gate passes can be used at the gate');
  let upd;
  if (action === 'out') {
    if (p.pass_date !== todayStr()) throw new HttpError(400, `This pass is valid only on ${p.pass_date}`);
    upd = await q(
      `UPDATE gate_passes SET gate_status='out', actual_out=?, out_marked_by=? WHERE id=? AND gate_status='not_left'`,
      [nowStr(), req.user.name, p.id]
    );
  } else {
    if (!p.coming_back) {
      // allowed, but record it
    }
    upd = await q(
      `UPDATE gate_passes SET gate_status='returned', actual_in=?, in_marked_by=? WHERE id=? AND gate_status='out'`,
      [nowStr(), req.user.name, p.id]
    );
  }
  if (!upd.affectedRows) throw new HttpError(409, action === 'out' ? 'Already marked out' : 'Employee has not been marked out yet, or is already back');
  await audit(req, {
    module: 'gate',
    action: action === 'out' ? 'marked_out' : 'marked_in',
    entityId: p.pass_no,
    description: `${req.user.name} marked ${p.emp_name} (${p.emp_code}) ${action === 'out' ? 'OUT' : 'IN'} on pass ${p.pass_no}`,
  });
  res.json(await one(`SELECT ${PASS_COLS} FROM gate_passes g WHERE g.id=?`, [p.id]));
});

/* ---------------- detail ---------------- */

r.get('/:id', async (req, res) => {
  const p = await one(
    `SELECT ${PASS_COLS}, u.photo, u.email, u.phone, u.designation, COALESCE(NULLIF(u.essl_code,''), u.emp_code) essl_key
       FROM gate_passes g LEFT JOIN users u ON u.id=g.user_id WHERE g.id=?`,
    [req.params.id]
  );
  if (!p) throw new HttpError(404, 'Request not found');
  const approvers = await q(
    `SELECT pa.level, pa.approver_id, x.name, x.emp_code, x.designation FROM pass_approvers pa JOIN users x ON x.id=pa.approver_id
      WHERE pa.pass_id=? ORDER BY FIELD(pa.level,'primary','secondary','third')`,
    [p.id]
  );
  const me = req.user;
  const allowed =
    p.user_id === me.id ||
    me.role === 'admin' ||
    approvers.some((a) => a.approver_id === me.id) ||
    (me.role === 'security' && p.status === 'approved');
  if (!allowed) throw new HttpError(404, 'Request not found');
  const punches = await q(
    `SELECT punch_time, direction, source FROM attendance_punches WHERE essl_code=? AND punch_time BETWEEN ? AND ? ORDER BY punch_time`,
    [p.essl_key, p.pass_date + ' 00:00:00', p.pass_date + ' 23:59:59']
  );
  delete p.essl_key;
  res.json({
    ...p,
    approvers,
    punches,
    canDecide: p.status === 'pending' && p.user_id !== me.id && (approvers.some((a) => a.approver_id === me.id) || me.role === 'admin'),
    canCancel: p.status === 'pending' && p.user_id === me.id,
  });
});

export default r;
