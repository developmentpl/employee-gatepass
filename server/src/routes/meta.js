import { Router } from 'express';
import { q } from '../db.js';
import { REASON_TYPES, EMPLOYEE_ROLES } from '../util.js';
import { listShifts } from './settings.js';

const r = Router();

r.get('/', async (_req, res) => {
  const depts = await q(`SELECT DISTINCT department d FROM users WHERE is_deleted=0 AND department IS NOT NULL AND department<>'' ORDER BY d`);
  const shifts = await listShifts(true);
  res.json({
    departments: depts.map((x) => x.d),
    shifts: shifts.map((s) => s.name),
    shiftList: shifts.map(({ name, start_time, end_time }) => ({ name, start_time, end_time })),
    reasonTypes: REASON_TYPES,
    roles: EMPLOYEE_ROLES,
  });
});

export default r;
