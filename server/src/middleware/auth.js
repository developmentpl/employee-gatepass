import jwt from 'jsonwebtoken';
import config from '../config.js';
import { one } from '../db.js';
import { HttpError } from '../util.js';

export function signToken(user) {
  return jwt.sign({ uid: user.id }, config.jwtSecret, { expiresIn: config.jwtExpires });
}

export async function requireAuth(req, _res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Please sign in'));
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return next(new HttpError(401, 'Session expired, please sign in again'));
  }
  const user = await one(
    `SELECT id, emp_code, name, email, department, designation, shift, phone, photo, role, must_change_password, essl_code
       FROM users WHERE id=? AND is_active=1 AND is_deleted=0`,
    [payload.uid]
  );
  if (!user) return next(new HttpError(401, 'Account is inactive or removed'));
  req.user = user;
  next();
}

export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user || !roles.includes(req.user.role)) return next(new HttpError(403, 'You do not have access to this'));
  next();
};
