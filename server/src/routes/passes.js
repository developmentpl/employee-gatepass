import { Router } from 'express';
import { q, one, tx } from '../db.js';
import { HttpError, paging, clean, likeTerm, nowStr, todayStr, REASON_TYPES, hm } from '../util.js';
import { requireRole } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { passSummaryHtml } from '../services/mailer.js';
import { notify } from '../services/notify.js';
import { visibleCond } from '../services/approvals.js';
import { numSetting } from '../services/settings.js';
import { sendCsv } from '../services/csv.js';
import { ensurePerson } from './security.js';

const r = Router();

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const LEVEL_LABEL = { primary: 'Primary', secondary: 'Secondary', third: 'Third', admin: 'Admin' };
const GATE_ROLES = ['security', 'security_admin', 'admin'];

const PASS_COLS = `g.id, g.pass_no, g.user_id, g.emp_code, g.emp_name, g.department, g.shift,
  TIME_FORMAT(g.shift_start,'%H:%i') shift_start, TIME_FORMAT(g.shift_end,'%H:%i') shift_end, g.pass_date,
  g.reason_type, g.reason, g.out_time, g.coming_back, g.expected_in_time, g.status, g.decided_by, g.decided_by_name,
  g.decided_level, g.decided_at, g.decision_remark, g.gate_status, g.actual_out, g.actual_in, g.out_marked_by,
  g.in_marked_by, g.out_security_login, g.in_security_login, g.escalated_seq, g.created_at,
  g.nr_status, g.nr_notified_at, g.nr_reason, g.nr_reason_at, g.nr_decided_by_name, g.nr_decided_at, g.nr_remark,
  g.raised_by_id, g.raised_by_name`;

const loginLabel = (u) => `${u.emp_code} · ${u.name}`;
const passLink = (p) => `${p.pass_no} – ${p.emp_name}`;

async function approverIds(passId) {
  return (await q(`SELECT approver_id FROM pass_approvers WHERE pass_id=?`, [passId])).map((x) => x.approver_id);
}

/* ---------------- employee: my requests ---------------- */

r.get('/mine', async (req, res) => {
  const { page, pageSize, offset } = paging(req.query, 10);
  const where = ['g.user_id=?'];
  const params = [req.user.id];
  if (req.query.status === 'action') where.push(`g.nr_status='awaiting_reason' AND g.gate_status='out'`);
  else if (req.query.status) {
    where.push('g.status=?');
    params.push(req.query.status);
  }
  const w = where.join(' AND ');
  const total = (await one(`SELECT COUNT(*) c FROM gate_passes g WHERE ${w}`, params)).c;
  const rows = await q(`SELECT ${PASS_COLS} FROM gate_passes g WHERE ${w} ORDER BY g.id DESC LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  res.json({ rows, total, page, pageSize });
});

r.post('/', async (req, res) => {
  const me = req.user;
  if (me.role === 'security') throw new HttpError(403, 'Security gate logins cannot raise gate passes');
  const b = req.body || {};
  // Admin can raise a gate pass on behalf of another employee (for_user_id).
  let u = me;
  const onBehalf = b.for_user_id && Number(b.for_user_id) !== me.id;
  if (onBehalf) {
    if (me.role !== 'admin') throw new HttpError(403, 'Only an admin can raise a gate pass for someone else');
    u = await one(`SELECT id, emp_code, name, email, department, shift, role FROM users WHERE id=? AND is_deleted=0`, [Number(b.for_user_id)]);
    if (!u) throw new HttpError(404, 'Employee not found');
    if (u.role === 'security') throw new HttpError(400, 'A security gate login cannot have a gate pass');
    const act = await one(`SELECT is_active FROM users WHERE id=?`, [u.id]);
    if (!act.is_active) throw new HttpError(400, `${u.name} is inactive. Activate the user first.`);
  }
  const pass_date = clean(b.pass_date) || todayStr();
  const reason_type = clean(b.reason_type);
  const reason = clean(b.reason);
  const out_time = clean(b.out_time);
  const coming_back = b.coming_back === true || b.coming_back === 'true' || b.coming_back === 1 || b.coming_back === '1';
  const expected_in_time = coming_back ? clean(b.expected_in_time) : null;
  const shiftName = clean(b.shift) || u.shift || '';

  if (!/^\d{4}-\d{2}-\d{2}$/.test(pass_date)) throw new HttpError(400, 'Date is not valid');
  if (pass_date < todayStr()) throw new HttpError(400, 'Gate pass date cannot be in the past');
  const max = new Date();
  max.setDate(max.getDate() + 30);
  if (pass_date > todayStr(max)) throw new HttpError(400, 'Gate pass can be raised at most 30 days in advance');
  if (!REASON_TYPES.includes(reason_type)) throw new HttpError(400, 'Select the purpose: Official or Personal');
  if (!reason) throw new HttpError(400, 'Write the reason for going out');
  if (reason.length > 500) throw new HttpError(400, 'Reason must be under 500 characters');
  if (!shiftName) throw new HttpError(400, onBehalf ? 'Select the shift' : 'Select your shift');
  const shift = await one(`SELECT name, start_time, end_time FROM shifts WHERE name=? AND is_active=1`, [shiftName]);
  if (!shift) throw new HttpError(400, `Shift "${shiftName}" is not available. Select another shift.`);
  if (!TIME_RE.test(out_time)) throw new HttpError(400, 'Enter out time');
  if (coming_back) {
    if (!TIME_RE.test(expected_in_time || '')) throw new HttpError(400, 'Enter expected time of arrival');
    if (expected_in_time <= out_time) throw new HttpError(400, 'Expected arrival must be after out time');
  }

  const auth = await one(`SELECT a.primary_id, a.secondary_id, a.third_id FROM authorities a WHERE a.user_id=?`, [u.id]);
  if (!auth) throw new HttpError(400, onBehalf ? `No approving authority is assigned to ${u.name}. Set it in User Access Management first.` : 'No approving authority is assigned to you yet. Please contact the administrator.');
  const approverRows = await q(`SELECT id, name, email FROM users WHERE id IN (?) AND is_active=1 AND is_deleted=0`, [
    [auth.primary_id, auth.secondary_id, auth.third_id].filter(Boolean),
  ]);
  const activeIds = new Set(approverRows.map((x) => x.id));
  const approvers = [
    ['primary', auth.primary_id],
    ['secondary', auth.secondary_id],
    ['third', auth.third_id],
  ].filter(([, id]) => id && activeIds.has(id));
  if (!approvers.length) throw new HttpError(400, onBehalf ? `${u.name}'s authorities are inactive. Update them in User Access Management.` : 'Your assigned authorities are inactive. Please contact the administrator.');

  const now = nowStr();
  const pass = await tx(async (run) => {
    const ins = await run(
      `INSERT INTO gate_passes (user_id, emp_code, emp_name, department, shift, shift_start, shift_end, pass_date, reason_type, reason, out_time, coming_back, expected_in_time, created_at, raised_by_id, raised_by_name)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [u.id, u.emp_code, u.name, u.department, shift.name, shift.start_time, shift.end_time, pass_date, reason_type, reason, out_time, coming_back ? 1 : 0, expected_in_time, now, onBehalf ? me.id : null, onBehalf ? me.name : null]
    );
    const id = ins.insertId;
    const passNo = `GP-${pass_date.replace(/-/g, '').slice(2)}-${String(id).padStart(5, '0')}`;
    await run(`UPDATE gate_passes SET pass_no=? WHERE id=?`, [passNo, id]);
    // escalation order: primary first; the others see it later (Settings → Approvals)
    let seq = 0;
    for (const [level, aid] of approvers) {
      await run(`INSERT INTO pass_approvers (pass_id, approver_id, level, seq, notified_at) VALUES (?,?,?,?,?)`, [id, aid, level, seq, seq === 0 ? now : null]);
      seq++;
    }
    return (await run(`SELECT ${PASS_COLS} FROM gate_passes g WHERE g.id=?`, [id]))[0];
  });

  await audit(req, {
    module: 'gatepass',
    action: 'requested',
    entityId: pass.pass_no,
    description: `${onBehalf ? `${me.name} raised gate pass ${pass.pass_no} on behalf of ${u.name} (${u.emp_code})` : `${u.name} (${u.emp_code}) requested gate pass ${pass.pass_no}`} – ${reason_type}, out ${out_time}${coming_back ? `, back by ${expected_in_time}` : ', not returning'}`,
  });
  if (onBehalf) {
    await notify(
      u.id,
      { type: 'raised_for_you', title: `${me.name} raised a gate pass for you`, body: `${pass.pass_no} · ${reason_type} · out ${out_time}`, passId: pass.id },
      { subject: `Gate pass ${pass.pass_no} raised for you by ${me.name}`, html: passSummaryHtml(pass, `${me.name} (admin) has raised this gate pass on your behalf. It has been sent to your authority for approval.`) }
    );
  }
  const first = approverRows.find((x) => x.id === approvers[0][1]);
  await notify(
    first.id,
    { type: 'approval_needed', title: `Gate pass approval needed: ${u.name}`, body: `${pass.pass_no} · ${reason_type} · out ${out_time}`, passId: pass.id },
    { subject: `Gate pass approval needed: ${u.name} (${pass.pass_no})`, html: passSummaryHtml(pass, onBehalf ? `${me.name} (admin) has raised a gate pass for ${u.name}, waiting for your approval.` : `${u.name} has requested a gate pass and is waiting for your approval.`) }
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

/** Employee explains why they did not come back. Goes to all their authorities. */
r.post('/:id/not-returned-reason', async (req, res) => {
  const p = await one(`SELECT * FROM gate_passes WHERE id=?`, [req.params.id]);
  if (!p || p.user_id !== req.user.id) throw new HttpError(404, 'Request not found');
  const reason = clean(req.body?.reason);
  if (!reason) throw new HttpError(400, 'Please write the reason');
  if (reason.length > 500) throw new HttpError(400, 'Reason must be under 500 characters');
  const upd = await q(
    `UPDATE gate_passes SET nr_status='reason_submitted', nr_reason=?, nr_reason_at=? WHERE id=? AND nr_status='awaiting_reason' AND gate_status='out'`,
    [reason, nowStr(), p.id]
  );
  if (!upd.affectedRows) throw new HttpError(409, 'A reason is not needed for this gate pass any more');
  await audit(req, { module: 'gatepass', action: 'not_returned_reason', entityId: p.pass_no, description: `${req.user.name} gave reason for not returning on ${p.pass_no}: "${reason}"` });
  const fresh = await one(`SELECT ${PASS_COLS} FROM gate_passes g WHERE g.id=?`, [p.id]);
  await notify(
    await approverIds(p.id),
    { type: 'not_returned_reason', title: `${p.emp_name} did not return – please review`, body: `${p.pass_no}: "${reason}"`, passId: p.id },
    {
      subject: `${p.emp_name} did not return to the plant (${p.pass_no})`,
      html: passSummaryHtml(fresh, `${p.emp_name} did not return to the plant as planned and gave this reason: <b>${escapeHtml(reason)}</b>. Please approve or reject it in Gate Pass.`),
    }
  );
  res.json(fresh);
});

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------------- authority: approvals ---------------- */

r.get('/approvals', async (req, res) => {
  const { page, pageSize, offset } = paging(req.query, 10);
  const vis = await visibleCond();
  const where = ['pa.approver_id=?'];
  const params = [req.user.id];
  const tab = req.query.tab || 'pending';
  if (tab === 'pending') {
    where.push(`g.status='pending'`, vis.sql);
    params.push(...vis.params);
  } else if (tab === 'not_returned') {
    where.push(`g.nr_status='reason_submitted' AND g.gate_status='out'`);
  } else {
    // completed: decided requests that had reached this authority
    where.push(`g.status<>'pending'`, `(pa.seq <= g.escalated_seq OR TIMESTAMPADD(MINUTE, pa.seq * ?, g.created_at) <= COALESCE(g.decided_at, ?))`);
    params.push(vis.mins, nowStr());
  }
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
  const order = tab === 'completed' ? 'g.decided_at DESC, g.id DESC' : 'g.pass_date ASC, g.out_time ASC';
  const rows = await q(`SELECT ${PASS_COLS}, pa.level my_level, pa.seq my_seq, u.photo ${base} ORDER BY ${order} LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  // counts for the tabs
  const visC = await visibleCond();
  const counts = {
    pending: (await one(`SELECT COUNT(*) c FROM pass_approvers pa JOIN gate_passes g ON g.id=pa.pass_id WHERE pa.approver_id=? AND g.status='pending' AND ${visC.sql}`, [req.user.id, ...visC.params])).c,
    not_returned: (await one(`SELECT COUNT(*) c FROM pass_approvers pa JOIN gate_passes g ON g.id=pa.pass_id WHERE pa.approver_id=? AND g.nr_status='reason_submitted' AND g.gate_status='out'`, [req.user.id])).c,
  };
  res.json({ rows, total, page, pageSize, counts });
});

async function canSee(passId, userId) {
  const vis = await visibleCond();
  return !!(await one(`SELECT 1 FROM pass_approvers pa JOIN gate_passes g ON g.id=pa.pass_id WHERE pa.pass_id=? AND pa.approver_id=? AND ${vis.sql}`, [passId, userId, ...vis.params]));
}

r.post('/:id/decision', async (req, res) => {
  const id = Number(req.params.id);
  const decision = req.body?.decision;
  const remark = clean(req.body?.remark).slice(0, 500);
  if (!['approved', 'rejected'].includes(decision)) throw new HttpError(400, 'Invalid decision');
  if (decision === 'rejected' && !remark) throw new HttpError(400, 'Please give a reason for rejection');

  const p = await one(`SELECT * FROM gate_passes WHERE id=?`, [id]);
  if (!p) throw new HttpError(404, 'Request not found');
  if (p.user_id === req.user.id) throw new HttpError(403, 'You cannot approve your own request');
  const mine = await one(`SELECT level FROM pass_approvers WHERE pass_id=? AND approver_id=?`, [id, req.user.id]);
  const isAdmin = req.user.role === 'admin';
  if (!mine && !isAdmin) throw new HttpError(403, 'You are not an authority for this request');
  if (mine && !isAdmin && !(await canSee(id, req.user.id))) throw new HttpError(403, 'This request has not reached you yet');
  const level = mine ? mine.level : 'admin';

  const upd = await q(
    `UPDATE gate_passes SET status=?, decided_by=?, decided_by_name=?, decided_level=?, decided_at=?, decision_remark=? WHERE id=? AND status='pending'`,
    [decision, req.user.id, req.user.name, level, nowStr(), remark || null, id]
  );
  if (!upd.affectedRows) {
    const cur = await one(`SELECT status, decided_by_name FROM gate_passes WHERE id=?`, [id]);
    throw new HttpError(409, cur.status === 'cancelled' ? (cur.decided_by_name === 'System' ? 'This request was cancelled automatically because nobody answered it in time' : 'This request was cancelled') : `This request was already ${cur.status} by ${cur.decided_by_name || 'another authority'}`);
  }
  const fresh = await one(`SELECT ${PASS_COLS} FROM gate_passes g WHERE g.id=?`, [id]);
  await audit(req, {
    module: 'gatepass',
    action: decision,
    entityId: p.pass_no,
    description: `${req.user.name} (${LEVEL_LABEL[level]}${level === 'admin' ? '' : ' authority'}) ${decision} gate pass ${p.pass_no} of ${p.emp_name}${remark ? ` – "${remark}"` : ''}`,
  });
  await notify(
    p.user_id,
    { type: `pass_${decision}`, title: `Your gate pass was ${decision}`, body: `${p.pass_no} by ${req.user.name}${remark ? ` – "${remark}"` : ''}`, passId: p.id },
    { subject: `Your gate pass ${p.pass_no} was ${decision}`, html: passSummaryHtml(fresh, `Your gate pass request was <b>${decision}</b> by ${escapeHtml(req.user.name)}.`) }
  );
  res.json(fresh);
});

/** Admin: send a pending request on to the next authority now, without waiting. */
r.post('/:id/escalate', requireRole('admin'), async (req, res) => {
  const p = await one(`SELECT * FROM gate_passes WHERE id=?`, [req.params.id]);
  if (!p) throw new HttpError(404, 'Request not found');
  if (p.status !== 'pending') throw new HttpError(409, 'Only pending requests can be sent on');
  const mins = await numSetting('approval.escalationMinutes');
  const apps = await q(
    `SELECT pa.seq, pa.approver_id, u.name FROM pass_approvers pa JOIN users u ON u.id=pa.approver_id WHERE pa.pass_id=? ORDER BY pa.seq`,
    [p.id]
  );
  const elapsed = (Date.now() - new Date(p.created_at.replace(' ', 'T')).getTime()) / 60000;
  const visibleNow = Math.max(p.escalated_seq, mins > 0 ? Math.floor(elapsed / mins) : 99);
  const next = apps.find((a) => a.seq > visibleNow);
  if (!next) throw new HttpError(409, 'All authorities can already see this request');
  await q(`UPDATE gate_passes SET escalated_seq=? WHERE id=?`, [next.seq, p.id]);
  await q(`UPDATE pass_approvers SET notified_at=? WHERE pass_id=? AND seq<=? AND notified_at IS NULL`, [nowStr(), p.id, next.seq]);
  const toTell = apps.filter((a) => a.seq > visibleNow && a.seq <= next.seq);
  const fresh = await one(`SELECT ${PASS_COLS} FROM gate_passes g WHERE g.id=?`, [p.id]);
  await notify(
    toTell.map((a) => a.approver_id),
    { type: 'approval_needed', title: `Gate pass approval needed: ${p.emp_name}`, body: `${p.pass_no} · sent to you by admin`, passId: p.id },
    { subject: `Gate pass approval needed: ${p.emp_name} (${p.pass_no})`, html: passSummaryHtml(fresh, `${escapeHtml(req.user.name)} (admin) has sent this gate pass request to you for approval.`) }
  );
  await audit(req, { module: 'gatepass', action: 'escalated', entityId: p.pass_no, description: `${req.user.name} sent gate pass ${p.pass_no} of ${p.emp_name} on to ${next.name}` });
  res.json(fresh);
});

/** Authority (or admin) accepts or rejects the employee's reason for not returning. Closes the gate entry. */
r.post('/:id/not-returned-decision', async (req, res) => {
  const p = await one(`SELECT * FROM gate_passes WHERE id=?`, [req.params.id]);
  if (!p) throw new HttpError(404, 'Request not found');
  const decision = req.body?.decision;
  const remark = clean(req.body?.remark).slice(0, 500);
  if (!['approved', 'rejected'].includes(decision)) throw new HttpError(400, 'Invalid decision');
  if (decision === 'rejected' && !remark) throw new HttpError(400, 'Please give a remark when rejecting');
  const isAdmin = req.user.role === 'admin';
  const mine = await one(`SELECT 1 FROM pass_approvers WHERE pass_id=? AND approver_id=?`, [p.id, req.user.id]);
  if (!mine && !isAdmin) throw new HttpError(403, 'You are not an authority for this request');
  const allowed = isAdmin ? `nr_status IN ('awaiting_reason','reason_submitted')` : `nr_status='reason_submitted'`;
  const upd = await q(
    `UPDATE gate_passes SET nr_status=?, nr_decided_by=?, nr_decided_by_name=?, nr_decided_at=?, nr_remark=?, gate_status='not_returned'
      WHERE id=? AND gate_status='out' AND ${allowed}`,
    [decision, req.user.id, req.user.name, nowStr(), remark || null, p.id]
  );
  if (!upd.affectedRows) throw new HttpError(409, 'This has already been closed');
  await audit(req, {
    module: 'gatepass',
    action: `not_returned_${decision}`,
    entityId: p.pass_no,
    description: `${req.user.name} ${decision} the not-returned reason of ${p.emp_name} on ${p.pass_no}${remark ? ` – "${remark}"` : ''}`,
  });
  await notify(
    p.user_id,
    { type: `not_returned_${decision}`, title: `Your reason for not returning was ${decision}`, body: `${p.pass_no} by ${req.user.name}${remark ? ` – "${remark}"` : ''}`, passId: p.id },
    {
      subject: `Your reason for not returning (${p.pass_no}) was ${decision}`,
      html: passSummaryHtml(await one(`SELECT ${PASS_COLS} FROM gate_passes g WHERE g.id=?`, [p.id]), `Your reason for not returning to the plant was <b>${decision}</b> by ${escapeHtml(req.user.name)}${remark ? `: ${escapeHtml(remark)}` : '.'}`),
    }
  );
  res.json(await one(`SELECT ${PASS_COLS} FROM gate_passes g WHERE g.id=?`, [p.id]));
});

/* ---------------- admin: all requests ---------------- */

r.get('/all', requireRole('admin'), async (req, res) => {
  const { page, pageSize, offset } = paging(req.query);
  const where = ['1=1'];
  const params = [];
  if (req.query.tab === 'pending') where.push(`g.status='pending'`);
  if (req.query.tab === 'not_returned') where.push(`g.nr_status IN ('awaiting_reason','reason_submitted') AND g.gate_status='out'`);
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
  const mins = await numSetting('approval.escalationMinutes');
  const now = nowStr();
  const approversSub = `(SELECT GROUP_CONCAT(x.name ORDER BY pa.seq SEPARATOR ', ') FROM pass_approvers pa JOIN users x ON x.id=pa.approver_id WHERE pa.pass_id=g.id)`;
  // the furthest authority that can see a pending request now
  const reachedSub = `(SELECT GROUP_CONCAT(x.name ORDER BY pa.seq SEPARATOR ', ') FROM pass_approvers pa JOIN users x ON x.id=pa.approver_id
      WHERE pa.pass_id=g.id AND (pa.seq <= g.escalated_seq OR TIMESTAMPADD(MINUTE, pa.seq * ${Number(mins)}, g.created_at) <= '${now}'))`;
  const countsSub = `(SELECT COUNT(*) FROM pass_approvers pa WHERE pa.pass_id=g.id)`;
  if (req.query.format === 'csv') {
    const rows = await q(`SELECT ${PASS_COLS}, ${approversSub} approvers FROM gate_passes g WHERE ${w} ORDER BY g.id DESC LIMIT 50000`, params);
    return sendCsv(res, `gate-passes-${todayStr()}.csv`, [
      { label: 'Pass No', key: 'pass_no' },
      { label: 'Date', key: 'pass_date' },
      { label: 'Employee ID', key: 'emp_code' },
      { label: 'Employee Name', key: 'emp_name' },
      { label: 'Department', key: 'department' },
      { label: 'Shift', value: (r) => `${r.shift || ''}${r.shift_start ? ` (${r.shift_start}–${r.shift_end})` : ''}` },
      { label: 'Purpose', key: 'reason_type' },
      { label: 'Reason for going out', key: 'reason' },
      { label: 'Out Time', value: (r) => hm(r.out_time) },
      { label: 'Coming Back', value: (r) => (r.coming_back ? 'Yes' : 'No') },
      { label: 'Expected In', value: (r) => hm(r.expected_in_time) },
      { label: 'Authorities', key: 'approvers' },
      { label: 'Status', key: 'status' },
      { label: 'Decided By', key: 'decided_by_name' },
      { label: 'Decided At', key: 'decided_at' },
      { label: 'Remark', key: 'decision_remark' },
      { label: 'Checked Out', key: 'actual_out' },
      { label: 'Checked Out By', value: (r) => [r.out_marked_by, r.out_security_login].filter(Boolean).join(' / ') },
      { label: 'Checked In', key: 'actual_in' },
      { label: 'Checked In By', value: (r) => [r.in_marked_by, r.in_security_login].filter(Boolean).join(' / ') },
      { label: 'Not Returned Reason', key: 'nr_reason' },
      { label: 'Not Returned Decision', value: (r) => (['approved', 'rejected'].includes(r.nr_status) ? `${r.nr_status} by ${r.nr_decided_by_name}` : r.nr_status || '') },
      { label: 'Requested At', key: 'created_at' },
    ], rows);
  }
  const total = (await one(`SELECT COUNT(*) c FROM gate_passes g WHERE ${w}`, params)).c;
  const order = req.query.tab === 'pending' ? 'g.pass_date ASC, g.out_time ASC' : 'g.id DESC';
  const rows = await q(
    `SELECT ${PASS_COLS}, ${approversSub} approvers, ${reachedSub} reached, ${countsSub} approver_count FROM gate_passes g WHERE ${w} ORDER BY ${order} LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  const counts = {
    pending: (await one(`SELECT COUNT(*) c FROM gate_passes WHERE status='pending'`)).c,
    not_returned: (await one(`SELECT COUNT(*) c FROM gate_passes WHERE nr_status IN ('awaiting_reason','reason_submitted') AND gate_status='out'`)).c,
  };
  res.json({ rows, total, page, pageSize, counts });
});

/* ---------------- security: gate desk ---------------- */

r.get('/gate/list', requireRole(...GATE_ROLES), async (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : todayStr();
  const tab = req.query.tab || 'checkout';
  const conds = {
    // approved, still inside: check them out (that day)
    checkout: [`g.status='approved' AND g.gate_status='not_left' AND g.pass_date=?`, [date]],
    // out and expected back: any day until checked in or closed
    checkin: [`g.status='approved' AND g.gate_status='out' AND g.coming_back=1`, []],
    completed: [
      `g.pass_date=? AND (g.gate_status IN ('returned','not_returned') OR (g.gate_status='out' AND g.coming_back=0))`,
      [date],
    ],
  };
  if (!conds[tab]) throw new HttpError(400, 'Unknown tab');
  const where = [conds[tab][0]];
  const params = [...conds[tab][1]];
  if (req.query.search) {
    const t = likeTerm(req.query.search);
    where.push('(g.emp_name LIKE ? OR g.emp_code LIKE ? OR g.pass_no LIKE ?)');
    params.push(t, t, t);
  }
  const order = tab === 'checkin' ? 'g.pass_date, g.expected_in_time' : tab === 'completed' ? 'COALESCE(g.actual_in, g.nr_decided_at, g.actual_out) DESC' : 'g.out_time';
  const rows = await q(
    `SELECT ${PASS_COLS}, u.photo, u.designation FROM gate_passes g LEFT JOIN users u ON u.id=g.user_id WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 500`,
    params
  );
  const counts = {};
  for (const [k, [sql, p]] of Object.entries(conds)) counts[k] = (await one(`SELECT COUNT(*) c FROM gate_passes g WHERE ${sql}`, p)).c;
  res.json({ rows, date, counts });
});

r.post('/gate/:id/:action', requireRole(...GATE_ROLES), async (req, res) => {
  const { action } = req.params;
  if (!['out', 'in'].includes(action)) throw new HttpError(404, 'Unknown action');
  const p = await one(`SELECT * FROM gate_passes WHERE id=?`, [req.params.id]);
  if (!p || p.status !== 'approved') throw new HttpError(400, 'This employee does not have an approved gate pass');
  const person = await ensurePerson(req.body?.person);
  const login = loginLabel(req.user);
  const now = nowStr();
  let upd;
  if (action === 'out') {
    if (p.pass_date !== todayStr()) throw new HttpError(400, `This pass is valid only on ${p.pass_date}`);
    upd = await q(
      `UPDATE gate_passes SET gate_status='out', actual_out=?, out_marked_by=?, out_security_login=? WHERE id=? AND gate_status='not_left'`,
      [now, person, login, p.id]
    );
  } else {
    if (!p.coming_back) throw new HttpError(400, 'This employee said they will not return today, so there is no check-in');
    upd = await q(
      `UPDATE gate_passes SET gate_status='returned', actual_in=?, in_marked_by=?, in_security_login=?,
              nr_status=IF(nr_status IN ('awaiting_reason','reason_submitted'), 'returned_late', nr_status)
        WHERE id=? AND gate_status='out'`,
      [now, person, login, p.id]
    );
  }
  if (!upd.affectedRows) throw new HttpError(409, action === 'out' ? 'Already checked out' : 'Employee is not checked out, or is already back');
  await audit(req, {
    module: 'gate',
    action: action === 'out' ? 'checked_out' : 'checked_in',
    entityId: p.pass_no,
    description: `${person} (${login}) checked ${p.emp_name} (${p.emp_code}) ${action === 'out' ? 'OUT' : 'IN'} on pass ${p.pass_no}`,
  });
  res.json(await one(`SELECT ${PASS_COLS} FROM gate_passes g WHERE g.id=?`, [p.id]));
});

/* ---------------- detail ---------------- */

r.get('/:id', async (req, res) => {
  const p = await one(
    `SELECT ${PASS_COLS}, u.photo, u.email, u.phone, u.designation FROM gate_passes g LEFT JOIN users u ON u.id=g.user_id WHERE g.id=?`,
    [req.params.id]
  );
  if (!p) throw new HttpError(404, 'Request not found');
  const mins = await numSetting('approval.escalationMinutes');
  const approvers = await q(
    `SELECT pa.level, pa.seq, pa.approver_id, pa.notified_at, x.name, x.emp_code, x.designation,
            DATE_FORMAT(TIMESTAMPADD(MINUTE, pa.seq * ?, ?), '%Y-%m-%d %H:%i:%s') visible_from
       FROM pass_approvers pa JOIN users x ON x.id=pa.approver_id WHERE pa.pass_id=? ORDER BY pa.seq`,
    [mins, p.created_at, p.id]
  );
  const now = nowStr();
  for (const a of approvers) {
    a.visible = a.seq <= p.escalated_seq || a.visible_from <= now;
    if (a.seq <= p.escalated_seq && a.visible_from > now) a.visible_from = a.notified_at || now;
  }
  const me = req.user;
  const myApprover = approvers.find((a) => a.approver_id === me.id);
  const isAdmin = me.role === 'admin';
  const isGate = GATE_ROLES.includes(me.role);
  const allowed = p.user_id === me.id || isAdmin || (myApprover && (myApprover.visible || p.status !== 'pending')) || (isGate && p.status === 'approved');
  if (!allowed) throw new HttpError(404, 'Request not found');
  const pending = p.status === 'pending';
  res.json({
    ...p,
    approvers,
    escalationMinutes: mins,
    canDecide: pending && p.user_id !== me.id && ((myApprover && myApprover.visible) || isAdmin),
    canCancel: pending && p.user_id === me.id,
    canEscalate: pending && isAdmin && approvers.some((a) => !a.visible),
    canStateReason: p.user_id === me.id && p.nr_status === 'awaiting_reason' && p.gate_status === 'out',
    canDecideNotReturned:
      p.gate_status === 'out' && ((p.nr_status === 'reason_submitted' && (myApprover || isAdmin)) || (isAdmin && p.nr_status === 'awaiting_reason')),
  });
});

export default r;
