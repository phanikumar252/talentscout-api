import { rateLimit } from 'express-rate-limit';
import { env } from '../config/env.js';

const common = { standardHeaders: 'draft-7', legacyHeaders: false, skip: () => env.isTest };

/** Brute-force protection on login, keyed by IP. */
export const loginLimiter = rateLimit({ ...common, windowMs: 15 * 60_000, limit: 20 });

/** The interpreter and streaming are the expensive endpoints; limit per user, not per IP. */
export const chatLimiter = rateLimit({
  ...common,
  windowMs: 60_000,
  limit: 20,
  keyGenerator: (req) => req.auth.userId,
});
