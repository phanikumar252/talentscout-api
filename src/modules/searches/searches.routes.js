import { Router } from 'express';
import { z } from 'zod';
import { objectId, validate } from '../../middleware/validate.js';
import { criteriaSchema } from './criteria.schema.js';
import * as searches from './searches.service.js';
import { chatRouter } from '../chat/chat.routes.js';
import { candidatesRouter } from '../candidates/candidates.routes.js';
import { evaluationsRouter } from '../evaluations/evaluations.routes.js';

export const searchesRouter = Router();

const searchParams = z.object({ searchId: objectId });
const updateBody = z
  .object({ title: z.string().trim().min(1).max(120).optional(), criteria: criteriaSchema.optional() })
  .refine((body) => body.title !== undefined || body.criteria !== undefined, 'Nothing to update');

searchesRouter.get('/:searchId', validate({ params: searchParams }), async (req, res) => {
  res.json(await searches.getSearchDetail(req.auth, req.valid.params.searchId));
});

// Manual edits from the criteria panel (chat edits go through /chat).
searchesRouter.patch('/:searchId', validate({ params: searchParams, body: updateBody }), async (req, res) => {
  res.json(await searches.updateSearch(req.auth, req.valid.params.searchId, req.valid.body));
});

searchesRouter.delete('/:searchId', validate({ params: searchParams }), async (req, res) => {
  await searches.deleteSearch(req.auth, req.valid.params.searchId);
  res.status(204).end();
});

searchesRouter.use('/:searchId/chat', chatRouter);
searchesRouter.use('/:searchId/candidates', candidatesRouter);
searchesRouter.use('/:searchId/evaluations', evaluationsRouter);
