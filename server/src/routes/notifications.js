import { Router } from 'express';
import { q } from '../db.js';

const r = Router();

r.get('/', async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
  const rows = await q(
    `SELECT id, type, title, body, pass_id, is_read, created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT ?`,
    [req.user.id, limit]
  );
  res.json(rows);
});

r.post('/read-all', async (req, res) => {
  await q(`UPDATE notifications SET is_read=1 WHERE user_id=? AND is_read=0`, [req.user.id]);
  res.json({ ok: true });
});

r.post('/:id/read', async (req, res) => {
  await q(`UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?`, [req.params.id, req.user.id]);
  res.json({ ok: true });
});

export default r;
