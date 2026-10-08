import { q } from '../db.js';
import { nowStr } from '../util.js';

/**
 * Write an audit log entry. Never throws (logging must not break the request).
 */
export async function audit(req, { module, action, entityId = null, description = '', meta = null, actor = null }) {
  try {
    const u = actor || req?.user || null;
    const ip = req ? (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().slice(0, 64) : null;
    await q(
      `INSERT INTO audit_logs (created_at, actor_id, actor_name, actor_code, module, action, entity_id, description, meta, ip)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        nowStr(),
        u?.id || null,
        u?.name || (u ? null : 'System'),
        u?.emp_code || null,
        module,
        action,
        entityId == null ? null : String(entityId),
        String(description || '').slice(0, 1000),
        meta ? JSON.stringify(meta).slice(0, 60000) : null,
        ip,
      ]
    );
  } catch (e) {
    console.error('[audit] failed', e.message);
  }
}
