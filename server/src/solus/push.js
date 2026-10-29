import express, { Router } from 'express';
import crypto from 'crypto';
import { getSetting, setSetting } from '../db.js';
import { nowStr } from '../util.js';
import { insertPunches } from '../essl/punches.js';
import { parsePushBody } from './connector.js';

/**
 * POST /solus/punches   (on the backend port, like /iclock for eSSL)
 * Header:  X-API-Key: <key from Attendance → Solus>   (or ?key=…)
 * Body:    JSON  [{ "employeeId": "10234", "time": "2026-10-24 09:01:00", "direction": "IN", "device": "Main gate" }]
 *          or {"punches": [...]}, or CSV text with a header row.
 */
const r = Router();
r.use(express.text({ type: ['text/*', 'application/csv'], limit: '10mb' }));
r.use(express.json({ limit: '10mb' }));

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

r.post('/punches', async (req, res) => {
  const key = await getSetting('solus.push.apiKey', '');
  const given = req.headers['x-api-key'] || req.query.key;
  if (!key || !safeEqual(given, key)) return res.status(401).json({ error: 'Invalid or missing API key' });
  let punches;
  try {
    punches = parsePushBody(req.body);
  } catch (e) {
    return res.status(400).json({ error: e.message || 'Could not read the request body' });
  }
  const result = await insertPunches(punches, 'solus_push', 'solus');
  await setSetting('solus.push.lastAt', nowStr());
  await setSetting('solus.push.lastResult', `${result.inserted} new, ${result.duplicates} duplicates, ${result.invalid} unreadable`);
  console.log(`[Solus] push from ${(req.socket.remoteAddress || '').replace('::ffff:', '')}: ${result.inserted} new punch(es)`);
  res.json(result);
});

r.get('/health', (_req, res) => res.json({ ok: true, service: 'solus-push' }));

export default r;
