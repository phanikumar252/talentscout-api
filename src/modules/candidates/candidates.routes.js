import { Router } from 'express';
import { z } from 'zod';
import { objectId, validate } from '../../middleware/validate.js';
import * as candidates from './candidates.service.js';

export const candidatesRouter = Router({ mergeParams: true });

const listParams = z.object({ searchId: objectId });
const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});
const summaryParams = z.object({ searchId: objectId, candidateId: objectId });

candidatesRouter.get('/', validate({ params: listParams, query: listQuery }), async (req, res) => {
  res.json(await candidates.listCandidatesForSearch(req.auth, req.valid.params.searchId, req.valid.query));
});

candidatesRouter.post('/:candidateId/summary', validate({ params: summaryParams }), async (req, res) => {
  const { searchId, candidateId } = req.valid.params;
  res.json(await candidates.getOrCreateSummary(req.auth, searchId, candidateId));
});
