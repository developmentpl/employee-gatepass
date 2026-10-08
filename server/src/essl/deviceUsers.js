import { q } from '../db.js';
import { nowStr } from '../util.js';

/**
 * Users enrolled on the eSSL machines (ID + name as stored on the device), kept in the
 * device_users table. Admins use them to create matching accounts in User Management.
 */

/** users: [{ code, name, card, privilege, device }] */
export async function upsertDeviceUsers(users, source) {
  const valid = users.filter((u) => u && String(u.code || '').trim());
  if (!valid.length) return { received: users.length, saved: 0 };
  const now = nowStr();
  for (let i = 0; i < valid.length; i += 500) {
    const chunk = valid.slice(i, i + 500);
    await q(
      `INSERT INTO device_users (essl_code, name, card_no, privilege, device_sn, source, last_seen) VALUES ?
       ON DUPLICATE KEY UPDATE name=COALESCE(NULLIF(VALUES(name),''), name), card_no=COALESCE(NULLIF(VALUES(card_no),''), card_no),
         privilege=VALUES(privilege), device_sn=VALUES(device_sn), source=VALUES(source), last_seen=VALUES(last_seen)`,
      [chunk.map((u) => [String(u.code).trim(), (u.name || '').trim() || null, u.card || null, u.privilege ?? null, u.device || null, source, now])]
    );
  }
  return { received: users.length, saved: valid.length };
}

/**
 * Parse user records sent by the device. Handles the formats used by different firmware:
 *   "USER PIN=1\tName=Yash\tPri=0\tPasswd=\tCard=123\tGrp=1"          (OPERLOG / USERINFO)
 *   "user uid=1\tcardno=\tpin=1\tpassword=\tgroup=1\tname=Yash\tprivilege=0"  (tabledata)
 */
export function parseUserLines(text, device) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!/^user\b/i.test(line) && !/\bpin=/i.test(line)) continue;
    const kv = {};
    for (const part of line.replace(/^user\s+/i, '').split('\t')) {
      const i = part.indexOf('=');
      if (i > 0) kv[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
    }
    if (!kv.pin) continue;
    out.push({ code: kv.pin, name: kv.name || '', card: [kv.card, kv.cardno].find((c) => c && c !== '0') || '', privilege: kv.pri ?? kv.privilege ?? null, device });
  }
  return out;
}
