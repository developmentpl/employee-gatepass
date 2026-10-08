import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import config from '../config.js';
import { one, q } from '../db.js';
import { HttpError, nowStr } from '../util.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { savePhoto, removePhoto, memUpload } from '../services/photos.js';

const r = Router();

r.get('/config', (_req, res) => {
  const { tenantId, clientId } = config.microsoft;
  res.json({ microsoft: { enabled: !!(tenantId && clientId), tenantId, clientId } });
});

async function finishLogin(req, res, user, method) {
  await q(`UPDATE users SET last_login=? WHERE id=?`, [nowStr(), user.id]);
  await audit(req, {
    module: 'auth',
    action: 'login',
    entityId: user.id,
    description: `${user.name} signed in (${method})`,
    actor: user,
  });
  res.json({ token: signToken(user) });
}

r.post('/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!email || !password) throw new HttpError(400, 'Enter email and password');
  const user = await one(`SELECT * FROM users WHERE email=? AND is_deleted=0`, [email]);
  const ok = user && user.password_hash && (await bcrypt.compare(password, user.password_hash));
  if (!ok) {
    await audit(req, { module: 'auth', action: 'login_failed', description: `Failed sign-in for ${email}`, actor: user || { name: email } });
    throw new HttpError(401, 'Incorrect email or password');
  }
  if (!user.is_active) throw new HttpError(403, 'Your account is inactive. Contact the administrator.');
  await finishLogin(req, res, user, 'password');
});

let jwks = null;
r.post('/microsoft', async (req, res) => {
  const { tenantId, clientId } = config.microsoft;
  if (!tenantId || !clientId) throw new HttpError(400, 'Microsoft sign-in is not configured');
  const idToken = String(req.body?.idToken || '');
  if (!idToken) throw new HttpError(400, 'Missing Microsoft token');
  jwks ||= createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`));
  let claims;
  try {
    ({ payload: claims } = await jwtVerify(idToken, jwks, {
      issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
      audience: clientId,
    }));
  } catch (e) {
    throw new HttpError(401, 'Microsoft sign-in could not be verified');
  }
  const email = String(claims.email || claims.preferred_username || claims.upn || '').toLowerCase();
  const user = email ? await one(`SELECT * FROM users WHERE email=? AND is_deleted=0`, [email]) : null;
  if (!user) {
    await audit(req, { module: 'auth', action: 'login_failed', description: `Microsoft sign-in for unregistered ${email}`, actor: { name: email } });
    throw new HttpError(403, `${email || 'This account'} is not registered in Gate Pass. Contact the administrator.`);
  }
  if (!user.is_active) throw new HttpError(403, 'Your account is inactive. Contact the administrator.');
  // Microsoft users don't need to set a local password
  if (user.must_change_password) await q(`UPDATE users SET must_change_password=0 WHERE id=?`, [user.id]);
  await finishLogin(req, res, user, 'Microsoft');
});

r.get('/me', requireAuth, async (req, res) => {
  const u = req.user;
  const auth = await one(
    `SELECT COUNT(*) c FROM authorities a JOIN users x ON x.id=a.user_id AND x.is_deleted=0
      WHERE a.primary_id=? OR a.secondary_id=? OR a.third_id=?`,
    [u.id, u.id, u.id]
  );
  const myAuth = await one(
    `SELECT p.name p_name, p.emp_code p_code, s.name s_name, s.emp_code s_code, t.name t_name, t.emp_code t_code
       FROM authorities a
       LEFT JOIN users p ON p.id=a.primary_id
       LEFT JOIN users s ON s.id=a.secondary_id
       LEFT JOIN users t ON t.id=a.third_id
      WHERE a.user_id=?`,
    [u.id]
  );
  const hasPendingApprovals = await one(
    `SELECT COUNT(*) c FROM pass_approvers pa JOIN gate_passes g ON g.id=pa.pass_id WHERE pa.approver_id=? LIMIT 1`,
    [u.id]
  );
  res.json({
    user: u,
    isAuthority: auth.c > 0 || hasPendingApprovals.c > 0,
    authorities: myAuth
      ? [
          myAuth.p_name && { level: 'Primary', name: myAuth.p_name, emp_code: myAuth.p_code },
          myAuth.s_name && { level: 'Secondary', name: myAuth.s_name, emp_code: myAuth.s_code },
          myAuth.t_name && { level: 'Third', name: myAuth.t_name, emp_code: myAuth.t_code },
        ].filter(Boolean)
      : [],
  });
});

/** Badge counts for the sidebar. */
r.get('/summary', requireAuth, async (req, res) => {
  const u = req.user;
  const approvals = await one(
    `SELECT COUNT(*) c FROM pass_approvers pa JOIN gate_passes g ON g.id=pa.pass_id
      WHERE pa.approver_id=? AND g.status='pending'`,
    [u.id]
  );
  const mine = await one(`SELECT COUNT(*) c FROM gate_passes WHERE user_id=? AND status='pending'`, [u.id]);
  const out = { approvalsPending: approvals.c, myPending: mine.c };
  if (u.role === 'admin') {
    out.adminPending = (await one(`SELECT COUNT(*) c FROM gate_passes WHERE status='pending'`)).c;
  }
  res.json(out);
});

r.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword = '', newPassword = '' } = req.body || {};
  if (String(newPassword).length < 8) throw new HttpError(400, 'New password must be at least 8 characters');
  if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword))
    throw new HttpError(400, 'New password must contain letters and numbers');
  const row = await one(`SELECT password_hash FROM users WHERE id=?`, [req.user.id]);
  if (row.password_hash && !(await bcrypt.compare(String(currentPassword), row.password_hash)))
    throw new HttpError(400, 'Current password is incorrect');
  const hash = await bcrypt.hash(String(newPassword), 10);
  await q(`UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?`, [hash, req.user.id]);
  await audit(req, { module: 'auth', action: 'password_changed', entityId: req.user.id, description: `${req.user.name} changed password` });
  res.json({ ok: true });
});

/** Employee updates own photo (file upload or webcam). */
r.post('/me/photo', requireAuth, memUpload.single('photo'), async (req, res) => {
  const p = savePhoto(req, req.user.emp_code);
  removePhoto(req.user.photo);
  await q(`UPDATE users SET photo=? WHERE id=?`, [p, req.user.id]);
  await audit(req, { module: 'users', action: 'photo_updated', entityId: req.user.id, description: `${req.user.name} updated own photo` });
  res.json({ photo: p });
});

export default r;
