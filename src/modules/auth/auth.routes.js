import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { loginLimiter } from '../../middleware/rateLimits.js';
import { validate } from '../../middleware/validate.js';
import * as authService from './auth.service.js';

export const authRouter = Router();

const loginBody = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(200),
});

authRouter.post('/login', loginLimiter, validate({ body: loginBody }), async (req, res) => {
  const { email, password } = req.valid.body;
  res.json(await authService.login(email, password));
});

authRouter.get('/me', requireAuth, async (req, res) => {
  res.json(await authService.getProfile(req.auth.userId));
});
