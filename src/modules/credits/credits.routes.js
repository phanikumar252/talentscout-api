import { Router } from 'express';
import { getBalance } from './credits.service.js';

export const creditsRouter = Router();

creditsRouter.get('/me', async (req, res) => {
  res.json(await getBalance(req.auth.userId));
});
