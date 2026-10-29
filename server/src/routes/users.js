import { Router } from 'express';
import bcrypt from 'bcryptjs';
import config from '../config.js';
import { q, one, tx } from '../db.js';
import { HttpError, paging, EMAIL_RE, clean, likeTerm, EMPLOYEE_ROLES, todayStr, PUNCH_MATCH } from '../util.js';
import { requireRole } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { memUpload, savePhoto, removePhoto } from '../services/photos.js';
import { parseSheet, buildWorkbook, sendXlsx } from '../services/sheet.js';

/**
 * User Access Management: employees + their approving authorities, managed together.
 * (Security gate logins are managed separately under Security setup.)
 */
const r = Router();
r.use(requireRole('admin'));

const FIELDS = ['emp_code', 'name', 'email', 'phone', 'department', 'designation', 'shift', 'role', 'essl_code', 'solus_code'];
const ROLE_LABEL = { user: 'Employee', admin: 'Admin', security_admin: 'Security admin' };

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
  solus_code: ['Solus User ID', 'Solus ID', 'Solus Employee ID'],
  primary: ['Primary Authority ID', 'Primary Authority', 'Primary', 'Primary Emp ID'],
  secondary: ['Secondary Authority ID', 'Secondary Authority', 'Secondary', 'Secondary Emp ID'],
  third: ['Third Authority ID', 'Third Authority', 'Third', 'Third Emp ID', 'Tertiary Authority ID'],
};

function normalize(body) {
  const d = {};
  for (const f of FIELDS) d[f] = clean(body[f]);
  d.email = d.email.toLowerCase();
  d.role = (d.role || 'user').toLowerCase().replace(/[\s-]+/g, '_');
  if (d.role === 'employee') d.role = 'user';
  return d;
}

async function shiftNames() {
  return new Map((await q(`SELECT name FROM shifts`)).map((s) => [s.name.toLowerCase(), s.name]));
}

function validate(d, shifts) {
  const errs = [];
  if (!d.emp_code) errs.push('Employee ID is required');
  else if (!/^[A-Za-z0-9_\-/.]{1,50}$/.test(d.emp_code)) errs.push('Employee ID has invalid characters');
  if (!d.name) errs.push('Employee name is required');
  if (!d.email) errs.push('Email is required');
  else if (!EMAIL_RE.test(d.email)) errs.push('Email is not valid');
  if (!EMPLOYEE_ROLES.includes(d.role)) errs.push('Role must be Employee, Admin or Security admin');
  if (d.phone && !/^[0-9+\-\s()]{6,20}$/.test(d.phone)) errs.push('Phone number is not valid');
  if (d.shift) {
    const s = shifts.get(d.shift.toLowerCase());
    if (!s) errs.push(`Shift "${d.shift}" does not exist. Add it under Settings → Shifts first`);
    else d.shift = s;
  }
  return errs;
}

/** Who already uses this Employee ID / login ID or email (any user, incl. gate logins and removed users). */
async function uniqueClash(field, value, exceptId = 0) {
  if (!value) return null;
  const row = await one(`SELECT id, emp_code, name, role, is_deleted FROM users WHERE ${field}=? AND id<>? LIMIT 1`, [value, exceptId]);
  if (!row) return null;
  const who = row.role === 'security' ? `security gate login "${row.name}"` : `${row.name} (${row.emp_code})${row.is_deleted ? ', a removed user' : ''}`;
  return field === 'emp_code'
    ? `Employee ID ${value} is already used by ${who}. Choose a different Employee ID.`
    : `Email ${value} is already used by ${who}. Use a different email.`;
}

async function findDuplicate(d, exceptId = 0) {
  return (await uniqueClash('emp_code', d.emp_code, exceptId)) || (await uniqueClash('email', d.email, exceptId));
}

/** Checks the three authority ids for one employee. Returns [p, s, t] ids (nulls allowed). */
async function validateAccess(userId, ids) {
  const [p, s, t] = ids.map((x) => (x ? Number(x) : null));
  const list = [p, s, t].filter(Boolean);
  if (!list.length) return [null, null, null];
  if (!p) throw new HttpError(400, 'Choose the primary authority first');
  if (new Set(list).size !== list.length) throw new HttpError(400, 'The same person cannot be selected twice as authority');
  if (userId && list.includes(Number(userId))) throw new HttpError(400, 'An employee cannot be their own authority');
  const found = await q(`SELECT id FROM users WHERE id IN (?) AND is_active=1 AND is_deleted=0 AND role<>'security'`, [list]);
  if (found.length !== list.length) throw new HttpError(400, 'Every authority must be an active user. Add them as a user first.');
  return [p, s, t];
}

async function saveAccess(run, userId, [p, s, t], byId) {
  if (!p) {
    await run(`DELETE FROM authorities WHERE user_id=?`, [userId]);
    return;
  }
  await run(
    `INSERT INTO authorities (user_id, primary_id, secondary_id, third_id, updated_by) VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE primary_id=VALUES(primary_id), secondary_id=VALUES(secondary_id), third_id=VALUES(third_id), updated_by=VALUES(updated_by)`,
    [userId, p, s, t, byId]
  );
}

/* ---------------- list / lookup ---------------- */

const EMP_WHERE = `u.is_deleted=0 AND u.role<>'security'`;

r.get('/', async (req, res) => {
  const { page, pageSize, offset } = paging(req.query);
  const where = [EMP_WHERE];
  const params = [];
  if (req.query.search) {
    const t = likeTerm(req.query.search);
    where.push('(u.name LIKE ? OR u.emp_code LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR p.name LIKE ? OR s.name LIKE ? OR t.name LIKE ?)');
    params.push(t, t, t, t, t, t, t);
  }
  for (const f of ['department', 'shift', 'role']) {
    if (req.query[f]) {
      where.push(`u.${f}=?`);
      params.push(req.query[f]);
    }
  }
  if (req.query.status === 'active') where.push('u.is_active=1');
  if (req.query.status === 'inactive') where.push('u.is_active=0');
  if (req.query.assigned === 'yes') where.push('a.user_id IS NOT NULL');
  if (req.query.assigned === 'no') where.push('a.user_id IS NULL');
  const from = `FROM users u
    LEFT JOIN authorities a ON a.user_id=u.id
    LEFT JOIN users p ON p.id=a.primary_id
    LEFT JOIN users s ON s.id=a.secondary_id
    LEFT JOIN users t ON t.id=a.third_id
    WHERE ${where.join(' AND ')}`;
  const total = (await one(`SELECT COUNT(*) c ${from}`, params)).c;
  const sortable = { name: 'u.name', emp_code: 'u.emp_code', department: 'u.department', created_at: 'u.created_at' };
  const sort = sortable[req.query.sort] || 'u.name';
  const dir = req.query.dir === 'desc' ? 'DESC' : 'ASC';
  const since = todayStr() + ' 00:00:00';
  const rows = await q(
    `SELECT u.id, u.emp_code, u.name, u.email, u.phone, u.department, u.designation, u.shift, u.photo, u.role,
            u.is_active, u.essl_code, u.solus_code, u.last_login, u.created_at,
            p.id primary_id, p.name primary_name, p.emp_code primary_code,
            s.id secondary_id, s.name secondary_name, s.emp_code secondary_code,
            t.id third_id, t.name third_name, t.emp_code third_code,
            (SELECT CONCAT(pp.punch_time, '|', pp.direction) FROM attendance_punches pp
              WHERE ${PUNCH_MATCH('u', 'pp')} AND pp.punch_time >= ? ORDER BY pp.punch_time DESC LIMIT 1) AS last_punch,
            (SELECT MIN(pp.punch_time) FROM attendance_punches pp WHERE ${PUNCH_MATCH('u', 'pp')} AND pp.punch_time >= ?) AS first_punch
       ${from} ORDER BY ${sort} ${dir} LIMIT ? OFFSET ?`,
    [since, since, ...params, pageSize, offset]
  );
  const counts = await one(
    `SELECT COUNT(*) total, COALESCE(SUM(u.is_active=1),0) active, COALESCE(SUM(u.is_active=0),0) inactive,
            COALESCE(SUM(a.user_id IS NULL AND u.is_active=1),0) unassigned
       FROM users u LEFT JOIN authorities a ON a.user_id=u.id WHERE ${EMP_WHERE}`
  );
  res.json({ rows, total, page, pageSize, counts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Number(v)])) });
});

/** Quick search used by authority pickers: active employees only. */
r.get('/lookup', async (req, res) => {
  const t = likeTerm(req.query.q || '');
  const rows = await q(
    `SELECT id, emp_code, name, department, designation, photo FROM users
      WHERE is_deleted=0 AND is_active=1 AND role<>'security' AND (name LIKE ? OR emp_code LIKE ? OR email LIKE ?)
      ORDER BY name LIMIT 20`,
    [t, t, t]
  );
  res.json(rows);
});

/* ---------------- bulk upload (users + access in one file) ---------------- */

const SAMPLE_HEADERS = [
  'Employee ID*', 'Employee Name*', 'Email*', 'Phone', 'Department', 'Designation', 'Shift', 'Role',
  'eSSL User ID', 'Solus User ID', 'Primary Authority ID', 'Secondary Authority ID', 'Third Authority ID',
];

r.get('/bulk/sample', async (_req, res) => {
  const shifts = await q(`SELECT name, start_time, end_time FROM shifts WHERE is_active=1 ORDER BY sort_order, name`);
  const buf = buildWorkbook([
    {
      name: 'Users and access',
      widths: [14, 24, 30, 14, 16, 18, 10, 14, 13, 13, 20, 22, 18],
      rows: [
        SAMPLE_HEADERS,
        ['10010', 'Anil Deshmukh', 'anil.deshmukh@harman.com', '9876500001', 'Production', 'Plant Head', 'General', 'Employee', '', '', '', '', ''],
        ['10011', 'Priya Joshi', 'priya.joshi@harman.com', '9876500002', 'Production', 'Manager', 'General', 'Employee', '', '', '10010', '', ''],
        ['10234', 'Rahul Patil', 'rahul.patil@harman.com', '9876543210', 'Production', 'Engineer', shifts[1]?.name || 'A', 'Employee', '10234', '', '10011', '10010', ''],
      ],
    },
    {
      name: 'Instructions',
      widths: [110],
      rows: [
        ['How to fill this file — one row per employee, with their approving authorities'],
        ['• Columns marked * are mandatory. Keep the header row as it is.'],
        ['• Employee ID and Email must be unique. Employees already in the system are shown as "Already exists" and their details are not changed.'],
        ['• Role: Employee (default), Admin, or Security admin.'],
        ['• Shift must be one of the names on the "Shifts" sheet (Settings → Shifts in the app).'],
        ['• eSSL / Solus User ID: the ID on the biometric machine. Leave blank if it is the same as the Employee ID.'],
        ['• Authority columns take Employee IDs. Every authority must be a user: either already in the system, or added in another row of this same file.'],
        ['• Primary authority is needed before secondary or third. An employee cannot be their own authority.'],
        ['• Requests go to the primary authority first, then the secondary and third if not answered in time (Settings → Approvals).'],
        ['• For an employee already in the system, filling the authority columns updates their access.'],
      ],
    },
    {
      name: 'Shifts',
      widths: [16, 12, 12],
      rows: [['Shift', 'Start', 'End'], ...shifts.map((s) => [s.name, String(s.start_time || '').slice(0, 5), String(s.end_time || '').slice(0, 5)])],
    },
  ]);
  sendXlsx(res, 'gatepass-users-and-access.xlsx', buf);
});

async function analyzeRows(rawRows) {
  const shifts = await shiftNames();
  const rows = rawRows.map((raw) => {
    const d = normalize(raw);
    const out = {
      ...d,
      primary: clean(raw.primary),
      secondary: clean(raw.secondary),
      third: clean(raw.third),
      _row: raw._row,
      status: 'new',
      messages: [],
    };
    const errs = validate(out, shifts);
    if (errs.length) {
      out.status = 'error';
      out.messages.push(...errs);
    }
    return out;
  });

  // Everyone the file mentions: the employees and their authorities
  const codes = new Set();
  const emails = new Set();
  rows.forEach((r) => {
    ['emp_code', 'primary', 'secondary', 'third'].forEach((k) => r[k] && codes.add(r[k]));
    if (r.email) emails.add(r.email);
  });
  const existing = codes.size || emails.size
    ? await q(
        `SELECT u.id, u.emp_code, u.email, u.name, u.is_active, u.role, a.primary_id, a.secondary_id, a.third_id
           FROM users u LEFT JOIN authorities a ON a.user_id=u.id
          WHERE u.is_deleted=0 AND (u.emp_code IN (?) OR u.email IN (?))`,
        [codes.size ? [...codes] : [''], emails.size ? [...emails] : ['']]
      )
    : [];
  const byCode = new Map(existing.map((e) => [e.emp_code.toLowerCase(), e]));
  const byEmail = new Map(existing.filter((e) => e.email).map((e) => [e.email.toLowerCase(), e]));

  // Duplicates inside the file and against the system
  const seenCode = new Map();
  const seenEmail = new Map();
  for (const r of rows) {
    if (r.status === 'error' && !r.emp_code) continue;
    const c = r.emp_code.toLowerCase();
    if (seenCode.has(c)) {
      r.status = 'error';
      r.messages.push(`Employee ID repeated (row ${seenCode.get(c)})`);
      continue;
    }
    seenCode.set(c, r._row);
    if (r.email && seenEmail.has(r.email)) {
      r.status = 'error';
      r.messages.push(`Email repeated (row ${seenEmail.get(r.email)})`);
      continue;
    }
    if (r.email) seenEmail.set(r.email, r._row);
    const ex = byCode.get(c);
    if (ex) {
      r.existing = ex;
      if (r.status !== 'error') r.status = 'exists';
    } else if (r.email && byEmail.get(r.email) && r.status !== 'error') {
      r.status = 'error';
      r.messages.push(`Email already used by ${byEmail.get(r.email).name} (${byEmail.get(r.email).emp_code})`);
    }
  }

  // Authorities: must be a user in the system, or a valid new user in this file. Repeat until stable,
  // because a row that turns out invalid can no longer be someone else's authority.
  const allInFile = new Map(rows.filter((r) => r.emp_code).map((r) => [r.emp_code.toLowerCase(), r]));
  for (let pass = 0; pass < 6; pass++) {
    const newInFile = new Map(rows.filter((r) => r.status === 'new').map((r) => [r.emp_code.toLowerCase(), r]));
    let changed = false;
    for (const r of rows) {
      if (r.status === 'error' || r._authChecked === pass) continue;
      r._authChecked = pass;
      const msgs = [];
      const levels = [['primary', 'Primary'], ['secondary', 'Secondary'], ['third', 'Third']];
      const given = levels.filter(([k]) => r[k]);
      if (given.length && !r.primary) msgs.push('Primary authority is needed before secondary or third');
      const seen = new Set();
      r.authNames = {};
      for (const [k, label] of given) {
        const code = r[k].toLowerCase();
        if (code === r.emp_code.toLowerCase()) {
          msgs.push(`${label} authority cannot be the employee themself`);
          continue;
        }
        if (seen.has(code)) msgs.push(`${r[k]} is selected twice`);
        seen.add(code);
        const ex = byCode.get(code);
        if (ex) {
          if (!ex.is_active) msgs.push(`${label} authority ${r[k]} (${ex.name}) is inactive`);
          else if (ex.role === 'security') msgs.push(`${label} authority ${r[k]} is a security login, not an employee`);
          else r.authNames[k] = ex.name;
        } else if (newInFile.has(code)) {
          r.authNames[k] = `${newInFile.get(code).name} (new, row ${newInFile.get(code)._row})`;
        } else if (allInFile.has(code)) {
          msgs.push(`${label} authority ${r[k]} is in this file (row ${allInFile.get(code)._row}) but that row has errors — fix it first`);
        } else {
          msgs.push(`${label} authority ${r[k]} is not a user. Add them as a user first (in this file or in User Access Management)`);
        }
      }
      if (msgs.length) {
        r.status = 'error';
        r.messages.push(...msgs);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Existing employees: only their access can change
  const idOf = (code) => byCode.get(code.toLowerCase())?.id ?? null;
  for (const r of rows) {
    delete r._authChecked;
    if (r.status !== 'exists') continue;
    const ex = r.existing;
    const given = r.primary || r.secondary || r.third;
    const same =
      (ex.primary_id || null) === (r.primary ? idOf(r.primary) : null) &&
      (ex.secondary_id || null) === (r.secondary ? idOf(r.secondary) : null) &&
      (ex.third_id || null) === (r.third ? idOf(r.third) : null);
    if (!given || same) {
      r.status = 'duplicate';
      r.messages.push(`Already exists in the system as ${ex.name}${given ? '; access is the same' : ''} — nothing to change`);
    } else {
      r.status = 'update';
      r.messages.push(`Already exists in the system as ${ex.name} — details unchanged, access will be updated`);
    }
    delete r.existing;
  }
  for (const r of rows) {
    if (r.status === 'new') r.messages.push(r.primary ? 'New user with access' : 'New user (no authority yet — cannot raise gate passes until assigned)');
  }
  return rows;
}

function countStatuses(rows) {
  const counts = { total: rows.length, new: 0, update: 0, duplicate: 0, error: 0 };
  rows.forEach((x) => (counts[x.status] = (counts[x.status] || 0) + 1));
  return counts;
}

r.post('/bulk/preview', memUpload.single('file'), async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Choose a file to upload');
  const rows = parseSheet(req.file.buffer, HEADER_MAP);
  if (rows.length > 5000) throw new HttpError(400, 'Maximum 5000 rows per upload');
  const result = await analyzeRows(rows);
  res.json({ rows: result, counts: countStatuses(result) });
});

r.post('/bulk/commit', async (req, res) => {
  const input = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!input.length) throw new HttpError(400, 'Nothing to import');
  const analyzed = await analyzeRows(input);
  const toInsert = analyzed.filter((x) => x.status === 'new');
  const toUpdate = analyzed.filter((x) => x.status === 'update');
  const hash = await bcrypt.hash(config.defaultUserPassword, 10);
  let inserted = 0;
  let accessSet = 0;
  await tx(async (run) => {
    for (const d of toInsert) {
      const r2 = await run(
        `INSERT IGNORE INTO users (emp_code, name, email, phone, department, designation, shift, role, essl_code, solus_code, password_hash, must_change_password)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,1)`,
        [d.emp_code, d.name, d.email, d.phone || null, d.department || null, d.designation || null, d.shift || null, d.role, d.essl_code || null, d.solus_code || null, hash]
      );
      inserted += r2.affectedRows;
    }
    // now every authority exists — look up ids and save access
    const withAccess = [...toInsert, ...toUpdate].filter((x) => x.primary);
    if (withAccess.length) {
      const codes = new Set();
      withAccess.forEach((x) => ['emp_code', 'primary', 'secondary', 'third'].forEach((k) => x[k] && codes.add(x[k])));
      const ids = new Map((await run(`SELECT id, emp_code FROM users WHERE is_deleted=0 AND emp_code IN (?)`, [[...codes]])).map((u) => [u.emp_code.toLowerCase(), u.id]));
      const id = (c) => (c ? ids.get(c.toLowerCase()) ?? null : null);
      for (const x of withAccess) {
        await saveAccess(run, id(x.emp_code), [id(x.primary), id(x.secondary), id(x.third)], req.user.id);
        accessSet++;
      }
    }
  });
  const skipped = analyzed.length - inserted - toUpdate.length;
  await audit(req, {
    module: 'users',
    action: 'bulk_import',
    description: `Bulk upload: ${inserted} users added, ${accessSet} access assignments saved, ${toUpdate.length} existing users' access updated, ${skipped} rows skipped`,
    meta: { added: toInsert.map((x) => x.emp_code).slice(0, 500), updated: toUpdate.map((x) => x.emp_code).slice(0, 500) },
  });
  res.json({ added: inserted, 'access updated': toUpdate.length, skipped });
});

/* ---------------- single user + access ---------------- */

/** Live check while typing in the user form: { emp_code, email, name } → message or null. */
r.get('/check-unique', async (req, res) => {
  const exceptId = Number(req.query.exceptId) || 0;
  const emp_code = clean(req.query.emp_code);
  const email = clean(req.query.email)?.toLowerCase();
  const name = clean(req.query.name);
  let nameWarn = null;
  if (name) {
    const same = await q(`SELECT name, emp_code FROM users WHERE name=? AND id<>? AND is_deleted=0 AND role<>'security' LIMIT 3`, [name, exceptId]);
    if (same.length) nameWarn = `Another employee has the same name: ${same.map((x) => `${x.name} (${x.emp_code})`).join(', ')}. Check it is not the same person.`;
  }
  res.json({ emp_code: await uniqueClash('emp_code', emp_code, exceptId), email: await uniqueClash('email', email, exceptId), name: nameWarn });
});

/** What the admin needs to raise a gate pass for this employee. */
r.get('/:id/pass-info', async (req, res) => {
  const u = await one(
    `SELECT u.id, u.emp_code, u.name, u.department, u.shift, u.is_active,
            p.name p_name, p.is_active p_act, s.name s_name, s.is_active s_act, t.name t_name, t.is_active t_act
       FROM users u LEFT JOIN authorities a ON a.user_id=u.id
       LEFT JOIN users p ON p.id=a.primary_id AND p.is_deleted=0
       LEFT JOIN users s ON s.id=a.secondary_id AND s.is_deleted=0
       LEFT JOIN users t ON t.id=a.third_id AND t.is_deleted=0
      WHERE u.id=? AND u.is_deleted=0 AND u.role<>'security'`,
    [req.params.id]
  );
  if (!u) throw new HttpError(404, 'User not found');
  const authorities = [
    ['Primary', u.p_name, u.p_act],
    ['Secondary', u.s_name, u.s_act],
    ['Third', u.t_name, u.t_act],
  ].filter(([, n, a]) => n && a).map(([level, name]) => ({ level, name }));
  res.json({ id: u.id, emp_code: u.emp_code, name: u.name, department: u.department, shift: u.shift, is_active: u.is_active, authorities });
});

r.get('/:id', async (req, res) => {
  const u = await one(
    `SELECT u.id, u.emp_code, u.name, u.email, u.phone, u.department, u.designation, u.shift, u.photo, u.role, u.is_active,
            u.essl_code, u.solus_code, u.last_login, u.created_at, a.primary_id, a.secondary_id, a.third_id
       FROM users u LEFT JOIN authorities a ON a.user_id=u.id WHERE u.id=? AND u.is_deleted=0`,
    [req.params.id]
  );
  if (!u) throw new HttpError(404, 'User not found');
  res.json(u);
});

function accessIds(body) {
  return [body.primary_id, body.secondary_id, body.third_id];
}

async function accessText([p, s, t]) {
  const list = [p, s, t].filter(Boolean);
  if (!list.length) return 'no authorities';
  const names = new Map((await q(`SELECT id, name, emp_code FROM users WHERE id IN (?)`, [list])).map((x) => [x.id, `${x.name} (${x.emp_code})`]));
  return [p && `Primary: ${names.get(p)}`, s && `Secondary: ${names.get(s)}`, t && `Third: ${names.get(t)}`].filter(Boolean).join(', ');
}

r.post('/', memUpload.single('photo'), async (req, res) => {
  const d = normalize(req.body);
  const errs = validate(d, await shiftNames());
  if (errs.length) throw new HttpError(400, errs.join('. '));
  const dup = await findDuplicate(d);
  if (dup) throw new HttpError(409, dup);
  const access = await validateAccess(null, accessIds(req.body));
  const password = clean(req.body.password) || config.defaultUserPassword;
  const hash = await bcrypt.hash(password, 10);
  let photo = null;
  if (req.file || req.body.dataUrl) photo = savePhoto(req, d.emp_code);
  const id = await tx(async (run) => {
    const ins = await run(
      `INSERT INTO users (emp_code, name, email, phone, department, designation, shift, role, essl_code, solus_code, photo, password_hash, must_change_password)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)`,
      [d.emp_code, d.name, d.email, d.phone || null, d.department || null, d.designation || null, d.shift || null, d.role, d.essl_code || null, d.solus_code || null, photo, hash]
    );
    await saveAccess(run, ins.insertId, access, req.user.id);
    return ins.insertId;
  });
  await audit(req, {
    module: 'users',
    action: 'created',
    entityId: id,
    description: `Added user ${d.name} (${d.emp_code}), ${ROLE_LABEL[d.role]} — ${await accessText(access)}`,
    meta: d,
  });
  res.status(201).json({ id, photo });
});

r.put('/:id', memUpload.single('photo'), async (req, res) => {
  const id = Number(req.params.id);
  const before = await one(
    `SELECT u.*, a.primary_id, a.secondary_id, a.third_id FROM users u LEFT JOIN authorities a ON a.user_id=u.id
      WHERE u.id=? AND u.is_deleted=0 AND u.role<>'security'`,
    [id]
  );
  if (!before) throw new HttpError(404, 'User not found');
  const d = normalize(req.body);
  const errs = validate(d, await shiftNames());
  if (errs.length) throw new HttpError(400, errs.join('. '));
  const dup = await findDuplicate(d, id);
  if (dup) throw new HttpError(409, dup);
  if (before.role === 'admin' && d.role !== 'admin') await ensureAnotherAdmin(id);
  const access = await validateAccess(id, accessIds(req.body));
  let photo = before.photo;
  if (req.file || req.body.dataUrl) {
    photo = savePhoto(req, d.emp_code);
    removePhoto(before.photo);
  } else if (req.body.removePhoto === '1' || req.body.removePhoto === true) {
    removePhoto(before.photo);
    photo = null;
  }
  await tx(async (run) => {
    await run(
      `UPDATE users SET emp_code=?, name=?, email=?, phone=?, department=?, designation=?, shift=?, role=?, essl_code=?, solus_code=?, photo=? WHERE id=?`,
      [d.emp_code, d.name, d.email, d.phone || null, d.department || null, d.designation || null, d.shift || null, d.role, d.essl_code || null, d.solus_code || null, photo, id]
    );
    await saveAccess(run, id, access, req.user.id);
  });
  const changes = {};
  for (const f of FIELDS) if ((before[f] || '') !== (d[f] || '')) changes[f] = { from: before[f], to: d[f] };
  if (photo !== before.photo) changes.photo = 'changed';
  const accessChanged = ['primary_id', 'secondary_id', 'third_id'].some((k, i) => (before[k] || null) !== access[i]);
  if (accessChanged) changes.access = await accessText(access);
  await audit(req, {
    module: 'users',
    action: 'updated',
    entityId: id,
    description: `Updated user ${d.name} (${d.emp_code})${Object.keys(changes).length ? ': ' + Object.keys(changes).join(', ') : ''}${accessChanged ? ` — ${changes.access}` : ''}`,
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

/** Removes a user. Shared with Security setup (security logins). */
export async function removeUser(req, id) {
  if (id === req.user.id) throw new HttpError(400, 'You cannot remove your own account');
  const u = await one(`SELECT * FROM users WHERE id=? AND is_deleted=0`, [id]);
  if (!u) throw new HttpError(404, 'User not found');
  if (u.role === 'admin') await ensureAnotherAdmin(id);
  const history = await one(
    `SELECT (SELECT COUNT(*) FROM gate_passes WHERE user_id=?) + (SELECT COUNT(*) FROM pass_approvers WHERE approver_id=?) c`,
    [id, id]
  );
  await tx(async (run) => {
    // Remove them as anyone's authority; the next authority moves up
    await run(`UPDATE authorities SET third_id=NULL WHERE third_id=?`, [id]);
    await run(`UPDATE authorities SET secondary_id=third_id, third_id=NULL WHERE secondary_id=?`, [id]);
    await run(`UPDATE authorities SET primary_id=secondary_id, secondary_id=third_id, third_id=NULL WHERE primary_id=? AND secondary_id IS NOT NULL`, [id]);
    await run(`DELETE FROM authorities WHERE primary_id=? OR user_id=?`, [id, id]);
    if (history.c > 0) {
      // keep history: soft delete and free the ID/email for reuse
      await run(
        `UPDATE users SET is_deleted=1, is_active=0, emp_code=CONCAT(emp_code,'#del',id), email=IF(email IS NULL, NULL, CONCAT(email,'#del',id)) WHERE id=?`,
        [id]
      );
    } else {
      await run(`DELETE FROM users WHERE id=?`, [id]);
      removePhoto(u.photo);
    }
  });
  return u;
}

r.delete('/:id', async (req, res) => {
  const u = await removeUser(req, Number(req.params.id));
  await audit(req, { module: 'users', action: 'removed', entityId: u.id, description: `Removed user ${u.name} (${u.emp_code})` });
  res.json({ ok: true });
});

export default r;
