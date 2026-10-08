import { q } from '../db.js';
import { toDateTimeStr } from '../util.js';

/** ZKTeco/eSSL punch status codes → direction */
export function statusToDirection(s) {
  const n = Number(s);
  if ([0, 3, 4].includes(n)) return 'in';
  if ([1, 2, 5].includes(n)) return 'out';
  return 'unknown';
}

const pad = (n) => String(n).padStart(2, '0');

/**
 * Parse many date-time spellings to 'YYYY-MM-DD HH:mm:ss'.
 * Accepts YYYY-MM-DD HH:mm[:ss], YYYY/MM/DD, DD-MM-YYYY, DD/MM/YYYY (Indian day-first), and Date objects.
 */
export function parseDateTime(v, timePart) {
  if (v instanceof Date) return toDateTimeStr(v);
  let s = String(v || '').trim();
  if (timePart) s = `${s.split(' ')[0]} ${String(timePart).trim()}`;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i.exec(s);
  let y, mo, d, h, mi, se, ap;
  if (m) [, y, mo, d, h, mi, se, ap] = m;
  else {
    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i.exec(s);
    if (!m) return null;
    [, d, mo, y, h, mi, se, ap] = m;
    if (y.length === 2) y = '20' + y;
  }
  h = Number(h);
  if (ap) {
    if (/pm/i.test(ap) && h < 12) h += 12;
    if (/am/i.test(ap) && h === 12) h = 0;
  }
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31 || h > 23 || +mi > 59) return null;
  return `${y}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}:${pad(se || 0)}`;
}

/**
 * Store punches, skipping duplicates (same eSSL ID + same time).
 * punches: [{ code, time, direction, verify, device }]
 */
export async function insertPunches(punches, source) {
  const valid = punches.filter((p) => p && p.code && p.time);
  let inserted = 0;
  for (let i = 0; i < valid.length; i += 500) {
    const chunk = valid.slice(i, i + 500);
    const res = await q(
      `INSERT IGNORE INTO attendance_punches (essl_code, punch_time, direction, verify_mode, device_sn, source) VALUES ?`,
      [chunk.map((p) => [String(p.code).trim(), p.time, p.direction || 'unknown', p.verify ?? null, p.device ?? null, source])]
    );
    inserted += res.affectedRows;
  }
  let unknownIds = [];
  if (valid.length) {
    const codes = [...new Set(valid.map((p) => String(p.code).trim()))];
    const known = await q(
      `SELECT COALESCE(NULLIF(essl_code,''), emp_code) k FROM users WHERE is_deleted=0 AND COALESCE(NULLIF(essl_code,''), emp_code) IN (?)`,
      [codes]
    );
    const set = new Set(known.map((k) => k.k.toLowerCase()));
    unknownIds = codes.filter((c) => !set.has(c.toLowerCase()));
  }
  return {
    received: punches.length,
    valid: valid.length,
    inserted,
    duplicates: valid.length - inserted,
    invalid: punches.length - valid.length,
    unknownIds: unknownIds.slice(0, 50),
    unknownCount: unknownIds.length,
  };
}
