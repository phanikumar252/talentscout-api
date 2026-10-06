import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { unauthorized } from '../lib/errors.js';

export function signAccessToken(user) {
  return jwt.sign({ orgId: String(user.orgId) }, env.JWT_SECRET, {
    subject: String(user._id ?? user.id),
    expiresIn: env.JWT_EXPIRES_IN,
    algorithm: 'HS256',
  });
}

/**
 * Verifies the Bearer token and sets req.auth = { userId, orgId }.
 * Every downstream query scopes by req.auth.orgId. Tenant ids are never taken from the request body.
 */
export function requireAuth(req, _res, next) {
  const [scheme, token] = (req.get('authorization') ?? '').split(' ');
  if (scheme !== 'Bearer' || !token) return next(unauthorized());

  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    req.auth = { userId: payload.sub, orgId: payload.orgId };
    return next();
  } catch {
    return next(unauthorized('Invalid or expired token'));
  }
}
