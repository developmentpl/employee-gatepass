import { Router } from 'express';
import { q, one, tx, setSetting } from '../db.js';
import { HttpError, clean } from '../util.js';
import { requireRole } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { numSetting, SETTING_DEFAULTS, SETTING_RANGES } from '../services/settings.js';
import { emailSettings, saveEmailSettings, sendTestMail } from '../services/mailer.js';

const r = Router();
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/* ---------------- shifts (everyone reads; admin edits) ---------------- */

export async function listShifts(activeOnly = false) {
  return q(
    `SELECT s.id, s.name, TIME_FORMAT(s.start_time,'%H:%i') start_time, TIME_FORMAT(s.end_time,'%H:%i') end_time, s.is_active, s.sort_order,
            (SELECT COUNT(*) FROM users u WHERE u.shift=s.name AND u.is_deleted=0) users
       FROM shifts s ${activeOnly ? 'WHERE s.is_active=1' : ''} ORDER BY s.sort_order, s.name`
  );
}

r.get('/shifts', async (req, res) => {
  res.json(await listShifts(req.user.role !== 'admin' || req.query.active === '1'));
});

function readShift(body) {
  const d = { name: clean(body.name), start_time: clean(body.start_time), end_time: clean(body.end_time), is_active: body.is_active === false || body.is_active === 0 ? 0 : 1 };
  if (!d.name) throw new HttpError(400, 'Shift name is required');
  if (d.name.length > 50) throw new HttpError(400, 'Shift name is too long');
  if (!TIME_RE.test(d.start_time) || !TIME_RE.test(d.end_time)) throw new HttpError(400, 'Enter start and end time');
  if (d.start_time === d.end_time) throw new HttpError(400, 'Start and end time cannot be the same');
  return d;
}

r.post('/shifts', requireRole('admin'), async (req, res) => {
  const d = readShift(req.body || {});
  if (await one(`SELECT id FROM shifts WHERE name=?`, [d.name])) throw new HttpError(409, `Shift "${d.name}" already exists`);
  const order = (await one(`SELECT COALESCE(MAX(sort_order),0)+1 n FROM shifts`)).n;
  const ins = await q(`INSERT INTO shifts (name, start_time, end_time, is_active, sort_order) VALUES (?,?,?,?,?)`, [d.name, d.start_time, d.end_time, d.is_active, order]);
  await audit(req, { module: 'settings', action: 'shift_added', entityId: ins.insertId, description: `Added shift ${d.name} (${d.start_time}–${d.end_time})` });
  res.status(201).json({ id: ins.insertId });
});

r.put('/shifts/:id', requireRole('admin'), async (req, res) => {
  const before = await one(`SELECT * FROM shifts WHERE id=?`, [req.params.id]);
  if (!before) throw new HttpError(404, 'Shift not found');
  const d = readShift(req.body || {});
  if (d.name !== before.name && (await one(`SELECT id FROM shifts WHERE name=? AND id<>?`, [d.name, before.id]))) throw new HttpError(409, `Shift "${d.name}" already exists`);
  await tx(async (run) => {
    await run(`UPDATE shifts SET name=?, start_time=?, end_time=?, is_active=? WHERE id=?`, [d.name, d.start_time, d.end_time, d.is_active, before.id]);
    if (d.name !== before.name) await run(`UPDATE users SET shift=? WHERE shift=?`, [d.name, before.name]); // keep employees on the renamed shift
  });
  await audit(req, {
    module: 'settings',
    action: 'shift_updated',
    entityId: before.id,
    description: `Updated shift ${before.name} → ${d.name} (${d.start_time}–${d.end_time})${d.is_active ? '' : ', inactive'}`,
  });
  res.json({ ok: true });
});

r.delete('/shifts/:id', requireRole('admin'), async (req, res) => {
  const s = await one(`SELECT * FROM shifts WHERE id=?`, [req.params.id]);
  if (!s) throw new HttpError(404, 'Shift not found');
  const used = (await one(`SELECT COUNT(*) c FROM users WHERE shift=? AND is_deleted=0`, [s.name])).c;
  if (used) throw new HttpError(409, `${used} employee(s) are on shift ${s.name}. Move them to another shift first, or mark this shift inactive.`);
  await q(`DELETE FROM shifts WHERE id=?`, [s.id]);
  await audit(req, { module: 'settings', action: 'shift_deleted', entityId: s.id, description: `Deleted shift ${s.name}` });
  res.json({ ok: true });
});

/* ---------------- approval / gate timing ---------------- */

r.get('/general', requireRole('admin'), async (_req, res) => {
  const out = {};
  for (const k of Object.keys(SETTING_DEFAULTS)) out[k] = await numSetting(k);
  res.json(out);
});

r.put('/general', requireRole('admin'), async (req, res) => {
  const b = req.body || {};
  const changes = [];
  for (const k of Object.keys(SETTING_DEFAULTS)) {
    if (!(k in b)) continue;
    const v = Number(b[k]);
    const [min, max, msg] = SETTING_RANGES[k];
    if (!Number.isInteger(v) || v < min || v > max) throw new HttpError(400, msg);
    await setSetting(k, v);
    changes.push(`${k}=${v}`);
  }
  await audit(req, { module: 'settings', action: 'updated', description: `Updated settings: ${changes.join(', ')}` });
  res.json({ ok: true });
});

/* ---------------- email (SMTP) ---------------- */

r.get('/email', requireRole('admin'), async (_req, res) => {
  res.json(await emailSettings({ masked: true }));
});

r.put('/email', requireRole('admin'), async (req, res) => {
  const saved = await saveEmailSettings(req.body || {});
  await audit(req, { module: 'settings', action: 'email_updated', description: `Updated email settings: ${saved.host ? `${saved.host}:${saved.port}, user ${saved.user || '(none)'}` : 'emails turned off'}` });
  res.json(await emailSettings({ masked: true }));
});

r.post('/email/test', requireRole('admin'), async (req, res) => {
  const to = String(req.body?.to || req.user.email || '').trim();
  if (!to) throw new HttpError(400, 'Enter the email address to send the test to');
  try {
    await sendTestMail(to);
  } catch (e) {
    throw new HttpError(400, `Test email failed: ${e.message}`);
  }
  await audit(req, { module: 'settings', action: 'email_test', description: `Sent a test email to ${to}` });
  res.json({ ok: true, to });
});

export default r;
