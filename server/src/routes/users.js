import { Router } from 'express';
import bcrypt from 'bcryptjs';
import config from '../config.js';
import { q, one, tx } from '../db.js';
import { HttpError, paging, EMAIL_RE, clean, likeTerm, ROLES, todayStr } from '../util.js';
import { requireRole } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { memUpload, savePhoto, removePhoto } from '../services/photos.js';
import { parseSheet, buildWorkbook, sendXlsx } from '../services/sheet.js';

const r = Router();
r.use(requireRole('admin'));

const FIELDS = ['emp_code', 'name', 'email', 'phone', 'department', 'designation', 'shift', 'role', 'essl_code'];

const HEADER_MAP = {
  emp_code: ['Employee ID', 'Emp ID', 'Employee Code', 'Emp Code', 'EmpID'],
  name: ['Employee Name', 'Name', 'Full Name'],
  email: ['Email', 'Email ID', 'Mail', 'Mail ID', 'E-mail'],
  phone: ['Phone', 'Mobile', 'Mobile No', 'Contact'],
  department: ['Department', 'Dept'],
  designation: ['Designation', 'Title'],
  shift: ['Shift'],
  role: ['Role', 'Access Role'],
  essl_code: ['eSSL User ID', 'eSSL ID', 'Biometric ID', 'Device User ID'],
};

function normalize(body) {
  const d = {};
  for (const f of FIELDS) d[f] = clean(body[f]);
  d.email = d.email.toLowerCase();
  d.role = (d.role || 'user').toLowerCase();
  return d;
}

function validate(d) {
  const errs = [];
  if (!d.emp_code) errs.push('Employee ID is required');
  else if (!/^[A-Za-z0-9_\-/.]{1,50}$/.test(d.emp_code)) errs.push('Employee ID has invalid characters');
  if (!d.name) errs.push('Employee name is required');
  if (!d.email) errs.push('Email is required');
  else if (!EMAIL_RE.test(d.email)) errs.push('Email is not valid');
  if (!ROLES.includes(d.role)) errs.push(`Role must be one of: ${ROLES.join(', ')}`);
  if (d.phone && !/^[0-9+\-\s()]{6,20}$/.test(d.phone)) errs.push('Phone number is not valid');
  return errs;
}

async function findDuplicate(d, exceptId = 0) {
  const row = await one(
    `SELECT id, emp_code, email FROM users WHERE (emp_code=? OR email=?) AND id<>? LIMIT 1`,
    [d.emp_code, d.email, exceptId]
  );
  if (!row) return null;
  return row.emp_code.toLowerCase() === d.emp_code.toLowerCase()
    ? `Employee ID ${d.emp_code} already exists`
    : `Email ${d.email} is already used`;
}

/* ---------------- list / lookup ---------------- */

r.get('/', async (req, res) => {
  const { page, pageSize, offset } = paging(req.query);
  const where = ['u.is_deleted=0'];
  const params = [];
  if (req.query.search) {
    const t = likeTerm(req.query.search);
    where.push('(u.name LIKE ? OR u.emp_code LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)');
    params.push(t, t, t, t);
  }
  for (const f of ['department', 'shift', 'role']) {
    if (req.query[f]) {
      where.push(`u.${f}=?`);
      params.push(req.query[f]);
    }
  }
  if (req.query.status === 'active') where.push('u.is_active=1');
  if (req.query.status === 'inactive') where.push('u.is_active=0');
  const w = where.join(' AND ');
  const total = (await one(`SELECT COUNT(*) c FROM users u WHERE ${w}`, params)).c;
  const sortable = { name: 'u.name', emp_code: 'u.emp_code', department: 'u.department', created_at: 'u.created_at' };
  const sort = sortable[req.query.sort] || 'u.name';
  const dir = req.query.dir === 'desc' ? 'DESC' : 'ASC';
  const rows = await q(
    `SELECT u.id, u.emp_code, u.name, u.email, u.phone, u.department, u.designation, u.shift, u.photo, u.role,
            u.is_active, u.essl_code, u.last_login, u.created_at,
            (SELECT CONCAT(p.punch_time, '|', p.direction) FROM attendance_punches p
              WHERE p.essl_code = COALESCE(NULLIF(u.essl_code,''), u.emp_code) AND p.punch_time >= ?
              ORDER BY p.punch_time DESC LIMIT 1) AS last_punch,
            (SELECT MIN(p.punch_time) FROM attendance_punches p
              WHERE p.essl_code = COALESCE(NULLIF(u.essl_code,''), u.emp_code) AND p.punch_time >= ?) AS first_punch
       FROM users u WHERE ${w} ORDER BY ${sort} ${dir} LIMIT ? OFFSET ?`,
    [todayStr() + ' 00:00:00', todayStr() + ' 00:00:00', ...params, pageSize, offset]
  );
  res.json({ rows, total, page, pageSize });
});

/** Quick search used by employee pickers (access management). */
r.get('/lookup', async (req, res) => {
  const t = likeTerm(req.query.q || '');
  const rows = await q(
    `SELECT id, emp_code, name, department, designation, photo FROM users
      WHERE is_deleted=0 AND is_active=1 AND (name LIKE ? OR emp_code LIKE ? OR email LIKE ?)
      ORDER BY name LIMIT 20`,
    [t, t, t]
  );
  res.json(rows);
});

/* ---------------- bulk upload ---------------- */

r.get('/bulk/sample', (_req, res) => {
  const buf = buildWorkbook([
    {
      name: 'Users',
      widths: [14, 24, 30, 18, 18, 22, 10, 10, 14],
      rows: [
        ['Employee ID*', 'Employee Name*', 'Email*', 'Phone', 'Department', 'Designation', 'Shift', 'Role', 'eSSL User ID'],
        ['10234', 'Rahul Patil', 'rahul.patil@harman.com', '9876543210', 'Production', 'Engineer', 'A', 'user', '10234'],
        ['10235', 'Sneha Kulkarni', 'sneha.kulkarni@harman.com', '9876500000', 'Quality', 'Manager', 'General', 'user', ''],
      ],
    },
    {
      name: 'Instructions',
      widths: [100],
      rows: [
        ['How to fill this file'],
        ['• Columns marked * are mandatory. Keep the header row as it is.'],
        ['• Employee ID and Email must be unique. Rows already in the system are shown as duplicates and skipped.'],
        ['• Role: user (default), admin, or security.'],
        ['• eSSL User ID: the ID enrolled on the biometric machine. Leave blank if it is the same as Employee ID.'],
        ['• New users get the default password set by the administrator and must change it at first login (or sign in with Microsoft).'],
        ['• Photos can be added later from User Management (upload or webcam), or by the employee from their profile.'],
      ],
    },
  ]);
  sendXlsx(res, 'gatepass-users-sample.xlsx', buf);
});

async function analyzeRows(rows) {
  const codes = rows.map((r) => clean(r.emp_code)).filter(Boolean);
  const emails = rows.map((r) => clean(r.email).toLowerCase()).filter(Boolean);
  const existing = codes.length || emails.length
    ? await q(`SELECT emp_code, email FROM users WHERE emp_code IN (?) OR email IN (?)`, [codes.length ? codes : [''], emails.length ? emails : ['']])
    : [];
  const exCodes = new Set(existing.map((e) => e.emp_code.toLowerCase()));
  const exEmails = new Set(existing.map((e) => e.email.toLowerCase()));
  const seenCodes = new Map();
  const seenEmails = new Map();

  return rows.map((raw) => {
    const d = normalize(raw);
    const out = { ...d, _row: raw._row, status: 'new', messages: [] };
    const errs = validate(d);
    if (errs.length) {
      out.status = 'error';
      out.messages = errs;
      return out;
    }
    const c = d.emp_code.toLowerCase();
    if (exCodes.has(c)) out.messages.push('Employee ID already exists in the system');
    if (exEmails.has(d.email)) out.messages.push('Email already exists in the system');
    if (seenCodes.has(c)) out.messages.push(`Same Employee ID as row ${seenCodes.get(c)}`);
    if (seenEmails.has(d.email)) out.messages.push(`Same email as row ${seenEmails.get(d.email)}`);
    if (out.messages.length) out.status = 'duplicate';
    else {
      seenCodes.set(c, raw._row);
      seenEmails.set(d.email, raw._row);
    }
    return out;
  });
}

r.post('/bulk/preview', memUpload.single('file'), async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Choose a file to upload');
  const rows = parseSheet(req.file.buffer, HEADER_MAP);
  if (rows.length > 5000) throw new HttpError(400, 'Maximum 5000 rows per upload');
  const result = await analyzeRows(rows);
  const counts = { total: result.length, new: 0, duplicate: 0, error: 0 };
  result.forEach((x) => counts[x.status]++);
  res.json({ rows: result, counts });
});

r.post('/bulk/commit', async (req, res) => {
  const input = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!input.length) throw new HttpError(400, 'Nothing to import');
  const analyzed = await analyzeRows(input);
  const toInsert = analyzed.filter((x) => x.status === 'new');
  const hash = await bcrypt.hash(config.defaultUserPassword, 10);
  let inserted = 0;
  await tx(async (run) => {
    for (const d of toInsert) {
      const res2 = await run(
        `INSERT IGNORE INTO users (emp_code, name, email, phone, department, designation, shift, role, essl_code, password_hash, must_change_password)
         VALUES (?,?,?,?,?,?,?,?,?,?,1)`,
        [d.emp_code, d.name, d.email, d.phone || null, d.department || null, d.designation || null, d.shift || null, d.role, d.essl_code || null, hash]
      );
      inserted += res2.affectedRows;
    }
  });
  const skipped = analyzed.length - inserted;
  await audit(req, {
    module: 'users',
    action: 'bulk_import',
    description: `Bulk imported ${inserted} users (${skipped} skipped)`,
    meta: { inserted, skipped, codes: toInsert.map((x) => x.emp_code).slice(0, 500) },
  });
  res.json({ inserted, skipped });
});

/* ---------------- single user CRUD ---------------- */

r.get('/:id', async (req, res) => {
  const u = await one(
    `SELECT id, emp_code, name, email, phone, department, designation, shift, photo, role, is_active, essl_code, last_login, created_at
       FROM users WHERE id=? AND is_deleted=0`,
    [req.params.id]
  );
  if (!u) throw new HttpError(404, 'User not found');
  res.json(u);
});

r.post('/', memUpload.single('photo'), async (req, res) => {
  const d = normalize(req.body);
  const errs = validate(d);
  if (errs.length) throw new HttpError(400, errs.join('. '));
  const dup = await findDuplicate(d);
  if (dup) throw new HttpError(409, dup);
  const password = clean(req.body.password) || config.defaultUserPassword;
  const hash = await bcrypt.hash(password, 10);
  let photo = null;
  if (req.file || req.body.dataUrl) photo = savePhoto(req, d.emp_code);
  const ins = await q(
    `INSERT INTO users (emp_code, name, email, phone, department, designation, shift, role, essl_code, photo, password_hash, must_change_password)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,1)`,
    [d.emp_code, d.name, d.email, d.phone || null, d.department || null, d.designation || null, d.shift || null, d.role, d.essl_code || null, photo, hash]
  );
  await audit(req, {
    module: 'users',
    action: 'created',
    entityId: ins.insertId,
    description: `Added user ${d.name} (${d.emp_code})`,
    meta: d,
  });
  res.status(201).json({ id: ins.insertId, photo });
});

r.put('/:id', memUpload.single('photo'), async (req, res) => {
  const id = Number(req.params.id);
  const before = await one(`SELECT * FROM users WHERE id=? AND is_deleted=0`, [id]);
  if (!before) throw new HttpError(404, 'User not found');
  const d = normalize(req.body);
  const errs = validate(d);
  if (errs.length) throw new HttpError(400, errs.join('. '));
  const dup = await findDuplicate(d, id);
  if (dup) throw new HttpError(409, dup);
  if (before.role === 'admin' && d.role !== 'admin') await ensureAnotherAdmin(id);
  let photo = before.photo;
  if (req.file || req.body.dataUrl) {
    photo = savePhoto(req, d.emp_code);
    removePhoto(before.photo);
  } else if (req.body.removePhoto === '1' || req.body.removePhoto === true) {
    removePhoto(before.photo);
    photo = null;
  }
  await q(
    `UPDATE users SET emp_code=?, name=?, email=?, phone=?, department=?, designation=?, shift=?, role=?, essl_code=?, photo=? WHERE id=?`,
    [d.emp_code, d.name, d.email, d.phone || null, d.department || null, d.designation || null, d.shift || null, d.role, d.essl_code || null, photo, id]
  );
  const changes = {};
  for (const f of FIELDS) if ((before[f] || '') !== (d[f] || '')) changes[f] = { from: before[f], to: d[f] };
  if (photo !== before.photo) changes.photo = 'changed';
  await audit(req, {
    module: 'users',
    action: 'updated',
    entityId: id,
    description: `Updated user ${d.name} (${d.emp_code})${Object.keys(changes).length ? ': ' + Object.keys(changes).join(', ') : ''}`,
    meta: changes,
  });
  res.json({ ok: true, photo });
});

async function ensureAnotherAdmin(id) {
  const c = await one(`SELECT COUNT(*) c FROM users WHERE role='admin' AND is_active=1 AND is_deleted=0 AND id<>?`, [id]);
  if (c.c === 0) throw new HttpError(400, 'At least one active admin must remain');
}

r.patch('/:id/status', async (req, res) => {
  const id = Number(req.params.id);
  const active = req.body?.active ? 1 : 0;
  if (id === req.user.id && !active) throw new HttpError(400, 'You cannot deactivate your own account');
  const u = await one(`SELECT id, name, emp_code, role FROM users WHERE id=? AND is_deleted=0`, [id]);
  if (!u) throw new HttpError(404, 'User not found');
  if (!active && u.role === 'admin') await ensureAnotherAdmin(id);
  await q(`UPDATE users SET is_active=? WHERE id=?`, [active, id]);
  await audit(req, {
    module: 'users',
    action: active ? 'activated' : 'deactivated',
    entityId: id,
    description: `${active ? 'Activated' : 'Deactivated'} user ${u.name} (${u.emp_code})`,
  });
  res.json({ ok: true });
});

r.post('/:id/reset-password', async (req, res) => {
  const id = Number(req.params.id);
  const u = await one(`SELECT id, name, emp_code FROM users WHERE id=? AND is_deleted=0`, [id]);
  if (!u) throw new HttpError(404, 'User not found');
  const password = clean(req.body?.password) || config.defaultUserPassword;
  if (password.length < 6) throw new HttpError(400, 'Password must be at least 6 characters');
  await q(`UPDATE users SET password_hash=?, must_change_password=1 WHERE id=?`, [await bcrypt.hash(password, 10), id]);
  await audit(req, { module: 'users', action: 'password_reset', entityId: id, description: `Reset password for ${u.name} (${u.emp_code})` });
  res.json({ ok: true, password });
});

r.post('/:id/photo', memUpload.single('photo'), async (req, res) => {
  const id = Number(req.params.id);
  const u = await one(`SELECT id, name, emp_code, photo FROM users WHERE id=? AND is_deleted=0`, [id]);
  if (!u) throw new HttpError(404, 'User not found');
  const photo = savePhoto(req, u.emp_code);
  removePhoto(u.photo);
  await q(`UPDATE users SET photo=? WHERE id=?`, [photo, id]);
  await audit(req, { module: 'users', action: 'photo_updated', entityId: id, description: `Updated photo of ${u.name} (${u.emp_code})` });
  res.json({ photo });
});

r.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) throw new HttpError(400, 'You cannot remove your own account');
  const u = await one(`SELECT * FROM users WHERE id=? AND is_deleted=0`, [id]);
  if (!u) throw new HttpError(404, 'User not found');
  if (u.role === 'admin') await ensureAnotherAdmin(id);
  const history = await one(
    `SELECT (SELECT COUNT(*) FROM gate_passes WHERE user_id=?) + (SELECT COUNT(*) FROM pass_approvers WHERE approver_id=?) c`,
    [id, id]
  );
  await tx(async (run) => {
    // Remove them as anyone's authority; primary slot gets the secondary promoted if present
    await run(`UPDATE authorities SET third_id=NULL WHERE third_id=?`, [id]);
    await run(`UPDATE authorities SET secondary_id=third_id, third_id=NULL WHERE secondary_id=?`, [id]);
    await run(
      `UPDATE authorities SET primary_id=secondary_id, secondary_id=third_id, third_id=NULL WHERE primary_id=? AND secondary_id IS NOT NULL`,
      [id]
    );
    await run(`DELETE FROM authorities WHERE primary_id=? OR user_id=?`, [id, id]);
    if (history.c > 0) {
      // keep history: soft delete and free the ID/email for reuse
      await run(
        `UPDATE users SET is_deleted=1, is_active=0, emp_code=CONCAT(emp_code,'#del',id), email=CONCAT(email,'#del',id) WHERE id=?`,
        [id]
      );
    } else {
      await run(`DELETE FROM users WHERE id=?`, [id]);
      removePhoto(u.photo);
    }
  });
  await audit(req, { module: 'users', action: 'removed', entityId: id, description: `Removed user ${u.name} (${u.emp_code})` });
  res.json({ ok: true });
});

export default r;
