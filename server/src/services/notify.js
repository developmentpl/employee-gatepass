import { q } from '../db.js';
import { nowStr } from '../util.js';
import { sendMail } from './mailer.js';

/**
 * In-app notification (bell) + optional email for one or more users.
 * userIds: number | number[]; mail: { subject, html } sent to their email addresses when SMTP is set up.
 */
export async function notify(userIds, { type, title, body = '', passId = null }, mail = null) {
  const ids = [...new Set([].concat(userIds).filter(Boolean).map(Number))];
  if (!ids.length) return;
  try {
    const now = nowStr();
    await q(
      `INSERT INTO notifications (user_id, type, title, body, pass_id, created_at) VALUES ?`,
      [ids.map((id) => [id, type, String(title).slice(0, 200), String(body || '').slice(0, 1000), passId, now])]
    );
    if (mail) {
      const rows = await q(`SELECT email FROM users WHERE id IN (?) AND email IS NOT NULL AND is_active=1`, [ids]);
      sendMail(rows.map((r) => r.email), mail.subject, mail.html);
    }
  } catch (e) {
    console.error('[notify] failed', e.message);
  }
}
