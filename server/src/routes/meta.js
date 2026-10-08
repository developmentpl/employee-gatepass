import { Router } from 'express';
import { q } from '../db.js';
import { REASON_TYPES, ROLES } from '../util.js';

const r = Router();

const DEFAULT_SHIFTS = ['General', 'A', 'B', 'C'];

r.get('/', async (_req, res) => {
  const depts = await q(`SELECT DISTINCT department d FROM users WHERE is_deleted=0 AND department IS NOT NULL AND department<>'' ORDER BY d`);
  const shifts = await q(`SELECT DISTINCT shift s FROM users WHERE is_deleted=0 AND shift IS NOT NULL AND shift<>'' ORDER BY s`);
  res.json({
    departments: depts.map((x) => x.d),
    shifts: [...new Set([...DEFAULT_SHIFTS, ...shifts.map((x) => x.s)])],
    reasonTypes: REASON_TYPES,
    roles: ROLES,
  });
});

export default r;
