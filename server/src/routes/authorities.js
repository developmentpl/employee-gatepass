import { Router } from 'express';
import { q, one, tx } from '../db.js';
import { HttpError, paging, clean, likeTerm } from '../util.js';
import { requireRole } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { memUpload } from '../services/photos.js';
import { parseSheet, buildWorkbook, sendXlsx } from '../services/sheet.js';

const r = Router();
r.use(requireRole('admin'));

r.get('/', async (req, res) => {
  const { page, pageSize, offset } = paging(req.query);
  const where = ['u.is_deleted=0'];
  const params = [];
  if (req.query.search) {
    const t = likeTerm(req.query.search);
    where.push(`(u.name LIKE ? OR u.emp_code LIKE ? OR p.name LIKE ? OR p.emp_code LIKE ? OR s.name LIKE ? OR t.name LIKE ?)`);
    params.push(t, t, t, t, t, t);
  }
  if (req.query.department) {
    where.push('u.department=?');
    params.push(req.query.department);
  }
  if (req.query.assigned === 'yes') where.push('a.user_id IS NOT NULL');
  if (req.query.assigned === 'no') where.push('a.user_id IS NULL');
  const from = `FROM users u
    LEFT JOIN authorities a ON a.user_id=u.id
    LEFT JOIN users p ON p.id=a.primary_id
    LEFT JOIN users s ON s.id=a.secondary_id
    LEFT JOIN users t ON t.id=a.third_id
    WHERE ${where.join(' AND ')}`;
  const total = (await one(`SELECT COUNT(*) c ${from}`, params)).c;
  const rows = await q(
    `SELECT u.id, u.emp_code, u.name, u.department, u.designation, u.photo, u.is_active,
            p.id primary_id, p.name primary_name, p.emp_code primary_code,
            s.id secondary_id, s.name secondary_name, s.emp_code secondary_code,
            t.id third_id, t.name third_name, t.emp_code third_code,
            a.updated_at
       ${from} ORDER BY u.name LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  res.json({ rows, total, page, pageSize });
});

async function validateSet(userId, ids) {
  const [pId, sId, tId] = ids.map((x) => (x ? Number(x) : null));
  if (!pId) throw new HttpError(400, 'Primary authority is required');
  const list = [pId, sId, tId].filter(Boolean);
  if (new Set(list).size !== list.length) throw new HttpError(400, 'The same person cannot be selected twice');
  if (list.includes(Number(userId))) throw new HttpError(400, 'An employee cannot be their own authority');
  const found = await q(`SELECT id FROM users WHERE id IN (?) AND is_active=1 AND is_deleted=0`, [list]);
  if (found.length !== list.length) throw new HttpError(400, 'One of the selected authorities is not an active user');
  return [pId, sId, tId];
}

async function describe(ids) {
  const list = ids.filter(Boolean);
  if (!list.length) return {};
  const rows = await q(`SELECT id, name, emp_code FROM users WHERE id IN (?)`, [list]);
  return Object.fromEntries(rows.map((x) => [x.id, `${x.name} (${x.emp_code})`]));
}

r.put('/:userId', async (req, res) => {
  const userId = Number(req.params.userId);
  const u = await one(`SELECT id, name, emp_code FROM users WHERE id=? AND is_deleted=0`, [userId]);
  if (!u) throw new HttpError(404, 'Employee not found');
  const [p, s, t] = await validateSet(userId, [req.body?.primary_id, req.body?.secondary_id, req.body?.third_id]);
  const before = await one(`SELECT primary_id, secondary_id, third_id FROM authorities WHERE user_id=?`, [userId]);
  await q(
    `INSERT INTO authorities (user_id, primary_id, secondary_id, third_id, updated_by) VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE primary_id=VALUES(primary_id), secondary_id=VALUES(secondary_id), third_id=VALUES(third_id), updated_by=VALUES(updated_by)`,
    [userId, p, s, t, req.user.id]
  );
  const names = await describe([p, s, t]);
  await audit(req, {
    module: 'access',
    action: before ? 'updated' : 'assigned',
    entityId: userId,
    description: `Authorities for ${u.name} (${u.emp_code}) → Primary: ${names[p]}${s ? `, Secondary: ${names[s]}` : ''}${t ? `, Third: ${names[t]}` : ''}`,
    meta: { before, after: { primary_id: p, secondary_id: s, third_id: t } },
  });
  res.json({ ok: true });
});

r.delete('/:userId', async (req, res) => {
  const userId = Number(req.params.userId);
  const u = await one(`SELECT id, name, emp_code FROM users WHERE id=?`, [userId]);
  if (!u) throw new HttpError(404, 'Employee not found');
  await q(`DELETE FROM authorities WHERE user_id=?`, [userId]);
  await audit(req, { module: 'access', action: 'removed', entityId: userId, description: `Removed authorities of ${u.name} (${u.emp_code})` });
  res.json({ ok: true });
});

/* ---------------- bulk ---------------- */

const HEADER_MAP = {
  emp_code: ['Employee ID', 'Emp ID', 'Employee Code', 'Emp Code'],
  primary: ['Primary Authority ID', 'Primary Authority', 'Primary', 'Primary Emp ID'],
  secondary: ['Secondary Authority ID', 'Secondary Authority', 'Secondary', 'Secondary Emp ID'],
  third: ['Third Authority ID', 'Third Authority', 'Third', 'Third Emp ID', 'Tertiary Authority ID'],
};

r.get('/bulk/sample', (_req, res) => {
  const buf = buildWorkbook([
    {
      name: 'Authorities',
      widths: [16, 22, 24, 22],
      rows: [
        ['Employee ID*', 'Primary Authority ID*', 'Secondary Authority ID', 'Third Authority ID'],
        ['10234', '10235', '10010', ''],
        ['10236', '10235', '', ''],
      ],
    },
    {
      name: 'Instructions',
      widths: [100],
      rows: [
        ['How to fill this file'],
        ['• Use Employee IDs only. All employees and authorities must already exist in User Management.'],
        ['• Primary authority is mandatory; Secondary and Third are optional.'],
        ['• An employee cannot be their own authority, and the same person cannot appear twice in one row.'],
        ['• If an employee already has authorities, the row replaces them (shown as "Update" in the preview).'],
        ['• A request is decided by the first authority who approves or rejects it.'],
      ],
    },
  ]);
  sendXlsx(res, 'gatepass-authorities-sample.xlsx', buf);
});

async function analyze(rows) {
  const codes = new Set();
  rows.forEach((r) => ['emp_code', 'primary', 'secondary', 'third'].forEach((k) => clean(r[k]) && codes.add(clean(r[k]))));
  const users = codes.size
    ? await q(`SELECT id, emp_code, name, is_active FROM users WHERE is_deleted=0 AND emp_code IN (?)`, [[...codes]])
    : [];
  const byCode = new Map(users.map((u) => [u.emp_code.toLowerCase(), u]));
  const existing = users.length
    ? await q(`SELECT user_id, primary_id, secondary_id, third_id FROM authorities WHERE user_id IN (?)`, [users.map((u) => u.id)])
    : [];
  const exMap = new Map(existing.map((e) => [e.user_id, e]));
  const seen = new Map();

  return rows.map((raw) => {
    const out = {
      _row: raw._row,
      emp_code: clean(raw.emp_code),
      primary: clean(raw.primary),
      secondary: clean(raw.secondary),
      third: clean(raw.third),
      messages: [],
      status: 'new',
    };
    const look = (code, label, required) => {
      if (!code) {
        if (required) out.messages.push(`${label} is required`);
        return null;
      }
      const u = byCode.get(code.toLowerCase());
      if (!u) out.messages.push(`${label} ${code} not found`);
      else if (!u.is_active) out.messages.push(`${label} ${code} is inactive`);
      return u || null;
    };
    const emp = look(out.emp_code, 'Employee ID', true);
    const p = look(out.primary, 'Primary authority', true);
    const s = look(out.secondary, 'Secondary authority', false);
    const t = look(out.third, 'Third authority', false);
    out.emp_name = emp?.name || '';
    out.primary_name = p?.name || '';
    out.secondary_name = s?.name || '';
    out.third_name = t?.name || '';
    const ids = [p, s, t].filter(Boolean).map((x) => x.id);
    if (emp && ids.includes(emp.id)) out.messages.push('Employee cannot be their own authority');
    if (new Set(ids).size !== ids.length) out.messages.push('Same person selected twice');
    if (emp && seen.has(emp.id)) out.messages.push(`Employee repeated (row ${seen.get(emp.id)})`);
    if (out.messages.length) {
      out.status = 'error';
      return out;
    }
    seen.set(emp.id, raw._row);
    out.user_id = emp.id;
    out.primary_id = p.id;
    out.secondary_id = s?.id || null;
    out.third_id = t?.id || null;
    const ex = exMap.get(emp.id);
    if (ex) {
      const same = ex.primary_id === out.primary_id && (ex.secondary_id || null) === out.secondary_id && (ex.third_id || null) === out.third_id;
      out.status = same ? 'duplicate' : 'update';
      out.messages.push(same ? 'Already assigned exactly like this – skipped' : 'Will replace current authorities');
    }
    return out;
  });
}

r.post('/bulk/preview', memUpload.single('file'), async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Choose a file to upload');
  const rows = parseSheet(req.file.buffer, HEADER_MAP);
  if (rows.length > 5000) throw new HttpError(400, 'Maximum 5000 rows per upload');
  const result = await analyze(rows);
  const counts = { total: result.length, new: 0, update: 0, duplicate: 0, error: 0 };
  result.forEach((x) => counts[x.status]++);
  res.json({ rows: result, counts });
});

r.post('/bulk/commit', async (req, res) => {
  const input = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!input.length) throw new HttpError(400, 'Nothing to import');
  const analyzed = await analyze(input);
  const todo = analyzed.filter((x) => x.status === 'new' || x.status === 'update');
  await tx(async (run) => {
    for (const x of todo) {
      await run(
        `INSERT INTO authorities (user_id, primary_id, secondary_id, third_id, updated_by) VALUES (?,?,?,?,?)
         ON DUPLICATE KEY UPDATE primary_id=VALUES(primary_id), secondary_id=VALUES(secondary_id), third_id=VALUES(third_id), updated_by=VALUES(updated_by)`,
        [x.user_id, x.primary_id, x.secondary_id, x.third_id, req.user.id]
      );
    }
  });
  const added = todo.filter((x) => x.status === 'new').length;
  const updated = todo.length - added;
  await audit(req, {
    module: 'access',
    action: 'bulk_import',
    description: `Bulk authorities: ${added} assigned, ${updated} updated, ${analyzed.length - todo.length} skipped`,
    meta: { codes: todo.map((x) => x.emp_code).slice(0, 500) },
  });
  res.json({ added, updated, skipped: analyzed.length - todo.length });
});

export default r;
