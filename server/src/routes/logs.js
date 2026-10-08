import { Router } from 'express';
import { q, one } from '../db.js';
import { paging, likeTerm, todayStr } from '../util.js';
import { requireRole } from '../middleware/auth.js';
import { sendCsv } from '../services/csv.js';

const r = Router();
r.use(requireRole('admin'));

function build(query) {
  const where = ['1=1'];
  const params = [];
  if (query.module) {
    where.push('module=?');
    params.push(query.module);
  }
  if (query.action) {
    where.push('action=?');
    params.push(query.action);
  }
  if (query.from) {
    where.push('created_at>=?');
    params.push(query.from + ' 00:00:00');
  }
  if (query.to) {
    where.push('created_at<=?');
    params.push(query.to + ' 23:59:59');
  }
  if (query.search) {
    const t = likeTerm(query.search);
    where.push('(description LIKE ? OR actor_name LIKE ? OR actor_code LIKE ? OR entity_id LIKE ?)');
    params.push(t, t, t, t);
  }
  return { w: where.join(' AND '), params };
}

r.get('/', async (req, res) => {
  const { page, pageSize, offset } = paging(req.query, 25);
  const { w, params } = build(req.query);
  const total = (await one(`SELECT COUNT(*) c FROM audit_logs WHERE ${w}`, params)).c;
  const rows = await q(
    `SELECT id, created_at, actor_name, actor_code, module, action, entity_id, description, ip
       FROM audit_logs WHERE ${w} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  res.json({ rows, total, page, pageSize });
});

r.get('/actions', async (_req, res) => {
  res.json(await q(`SELECT DISTINCT module, action FROM audit_logs ORDER BY module, action`));
});

r.get('/export', async (req, res) => {
  const { w, params } = build(req.query);
  const rows = await q(
    `SELECT created_at, actor_name, actor_code, module, action, entity_id, description, ip
       FROM audit_logs WHERE ${w} ORDER BY id DESC LIMIT 100000`,
    params
  );
  sendCsv(res, `gatepass-logs-${todayStr()}.csv`, [
    { label: 'Date & Time', key: 'created_at' },
    { label: 'User', key: 'actor_name' },
    { label: 'Employee ID', key: 'actor_code' },
    { label: 'Module', key: 'module' },
    { label: 'Action', key: 'action' },
    { label: 'Reference', key: 'entity_id' },
    { label: 'Details', key: 'description' },
    { label: 'IP', key: 'ip' },
  ], rows);
});

export default r;
