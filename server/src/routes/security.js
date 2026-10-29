import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { q, one } from '../db.js';
import { HttpError, clean, likeTerm } from '../util.js';
import { requireRole } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { removeUser } from './users.js';

/**
 * Security setup, managed by the security admin (or admin):
 *  - security logins: shared gate accounts (e.g. "GATE1 – Main gate"), signed in with Login ID + password
 *  - security persons: the guards' names, picked or typed at check-out / check-in
 */
const r = Router();
const MANAGERS = ['security_admin', 'admin'];
const GATE_ROLES = ['security', 'security_admin', 'admin'];

/* ---------------- security persons ---------------- */

r.get('/persons', requireRole(...GATE_ROLES), async (req, res) => {
  const all = req.query.all === '1' && MANAGERS.includes(req.user.role);
  const rows = await q(
    `SELECT sp.id, sp.name, sp.phone, sp.is_active, sp.created_at,
            (SELECT COUNT(*) FROM gate_passes g WHERE g.out_marked_by=sp.name OR g.in_marked_by=sp.name) entries
       FROM security_persons sp ${all ? '' : 'WHERE sp.is_active=1'} ORDER BY sp.name`
  );
  res.json(rows);
});

/** Adds a guard name if it is not in the list yet (free typing at the gate). Returns the stored name. */
export async function ensurePerson(name) {
  const n = clean(name).replace(/\s+/g, ' ');
  if (!n) throw new HttpError(400, 'Enter the security person’s name');
  if (n.length > 150) throw new HttpError(400, 'Name is too long');
  const ex = await one(`SELECT name, is_active FROM security_persons WHERE name=?`, [n]);
  if (ex) {
    if (!ex.is_active) await q(`UPDATE security_persons SET is_active=1 WHERE name=?`, [ex.name]);
    return ex.name;
  }
  await q(`INSERT INTO security_persons (name) VALUES (?)`, [n]);
  return n;
}

r.post('/persons', requireRole(...MANAGERS), async (req, res) => {
  const name = clean(req.body?.name).replace(/\s+/g, ' ');
  if (!name) throw new HttpError(400, 'Enter a name');
  if (await one(`SELECT id FROM security_persons WHERE name=?`, [name])) throw new HttpError(409, `${name} is already in the list`);
  const ins = await q(`INSERT INTO security_persons (name, phone) VALUES (?,?)`, [name, clean(req.body?.phone) || null]);
  await audit(req, { module: 'security', action: 'person_added', entityId: ins.insertId, description: `Added security person ${name}` });
  res.status(201).json({ id: ins.insertId });
});

r.put('/persons/:id', requireRole(...MANAGERS), async (req, res) => {
  const p = await one(`SELECT * FROM security_persons WHERE id=?`, [req.params.id]);
  if (!p) throw new HttpError(404, 'Not found');
  const name = clean(req.body?.name).replace(/\s+/g, ' ');
  if (!name) throw new HttpError(400, 'Enter a name');
  if (name !== p.name && (await one(`SELECT id FROM security_persons WHERE name=? AND id<>?`, [name, p.id]))) throw new HttpError(409, `${name} is already in the list`);
  const active = req.body?.is_active === false || req.body?.is_active === 0 ? 0 : 1;
  await q(`UPDATE security_persons SET name=?, phone=?, is_active=? WHERE id=?`, [name, clean(req.body?.phone) || null, active, p.id]);
  await audit(req, { module: 'security', action: 'person_updated', entityId: p.id, description: `Updated security person ${p.name}${name !== p.name ? ` → ${name}` : ''}${active ? '' : ' (inactive)'}` });
  res.json({ ok: true });
});

r.delete('/persons/:id', requireRole(...MANAGERS), async (req, res) => {
  const p = await one(`SELECT * FROM security_persons WHERE id=?`, [req.params.id]);
  if (!p) throw new HttpError(404, 'Not found');
  await q(`DELETE FROM security_persons WHERE id=?`, [p.id]); // past gate entries keep the name as text
  await audit(req, { module: 'security', action: 'person_removed', entityId: p.id, description: `Removed security person ${p.name}` });
  res.json({ ok: true });
});

/* ---------------- security logins (gate accounts) ---------------- */

r.get('/logins', requireRole(...MANAGERS), async (req, res) => {
  const where = [`role='security'`, 'is_deleted=0'];
  const params = [];
  if (req.query.search) {
    const t = likeTerm(req.query.search);
    where.push('(name LIKE ? OR emp_code LIKE ?)');
    params.push(t, t);
  }
  res.json(await q(`SELECT id, emp_code login_id, name, phone, is_active, last_login, created_at FROM users WHERE ${where.join(' AND ')} ORDER BY emp_code`, params));
});

function readLogin(body, isNew) {
  const d = { login_id: clean(body.login_id), name: clean(body.name), phone: clean(body.phone), password: String(body.password || '') };
  if (!/^[A-Za-z0-9_\-.]{3,50}$/.test(d.login_id)) throw new HttpError(400, 'Login ID: 3–50 letters, numbers, - _ or .');
  if (!d.name) throw new HttpError(400, 'Enter a name for this login, e.g. Main gate');
  if ((isNew || d.password) && d.password.length < 6) throw new HttpError(400, 'Password must be at least 6 characters');
  return d;
}

r.post('/logins', requireRole(...MANAGERS), async (req, res) => {
  const d = readLogin(req.body || {}, true);
  {
    const c = await one(`SELECT name, emp_code FROM users WHERE emp_code=?`, [d.login_id]);
    if (c) throw new HttpError(409, `Login ID ${d.login_id} is already used by ${c.name}. Choose a different login ID.`);
  }
  const ins = await q(
    `INSERT INTO users (emp_code, name, email, phone, role, password_hash, must_change_password, department) VALUES (?,?,NULL,?,'security',?,0,'Security')`,
    [d.login_id, d.name, d.phone || null, await bcrypt.hash(d.password, 10)]
  );
  await audit(req, { module: 'security', action: 'login_added', entityId: ins.insertId, description: `Added security login ${d.login_id} (${d.name})` });
  res.status(201).json({ id: ins.insertId });
});

r.put('/logins/:id', requireRole(...MANAGERS), async (req, res) => {
  const u = await one(`SELECT * FROM users WHERE id=? AND role='security' AND is_deleted=0`, [req.params.id]);
  if (!u) throw new HttpError(404, 'Security login not found');
  const d = readLogin(req.body || {}, false);
  if (d.login_id !== u.emp_code) {
    const c = await one(`SELECT name FROM users WHERE emp_code=? AND id<>?`, [d.login_id, u.id]);
    if (c) throw new HttpError(409, `Login ID ${d.login_id} is already used by ${c.name}. Choose a different login ID.`);
  }
  const active = req.body?.is_active === false || req.body?.is_active === 0 ? 0 : 1;
  await q(`UPDATE users SET emp_code=?, name=?, phone=?, is_active=? WHERE id=?`, [d.login_id, d.name, d.phone || null, active, u.id]);
  if (d.password) await q(`UPDATE users SET password_hash=? WHERE id=?`, [await bcrypt.hash(d.password, 10), u.id]);
  await audit(req, {
    module: 'security',
    action: 'login_updated',
    entityId: u.id,
    description: `Updated security login ${u.emp_code}${d.login_id !== u.emp_code ? ` → ${d.login_id}` : ''}${d.password ? ', password changed' : ''}${active ? '' : ' (inactive)'}`,
  });
  res.json({ ok: true });
});

r.delete('/logins/:id', requireRole(...MANAGERS), async (req, res) => {
  const u = await one(`SELECT id FROM users WHERE id=? AND role='security' AND is_deleted=0`, [req.params.id]);
  if (!u) throw new HttpError(404, 'Security login not found');
  const removed = await removeUser(req, u.id);
  await audit(req, { module: 'security', action: 'login_removed', entityId: u.id, description: `Removed security login ${removed.emp_code} (${removed.name})` });
  res.json({ ok: true });
});

export default r;
