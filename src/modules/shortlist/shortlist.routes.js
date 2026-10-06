import { Router } from 'express';
import { z } from 'zod';
import { objectId, validate } from '../../middleware/validate.js';
import * as shortlist from './shortlist.service.js';

export const shortlistRouter = Router({ mergeParams: true });

const projectParams = z.object({ projectId: objectId });
const entryParams = z.object({ projectId: objectId, candidateId: objectId });
const addBody = z.object({
  candidateIds: z.array(objectId).min(1).max(100),
  searchId: objectId.optional(),
});

shortlistRouter.get('/', validate({ params: projectParams }), async (req, res) => {
  res.json(await shortlist.listShortlist(req.auth, req.valid.params.projectId));
});

shortlistRouter.post('/', validate({ params: projectParams, body: addBody }), async (req, res) => {
  res.status(201).json(await shortlist.addToShortlist(req.auth, req.valid.params.projectId, req.valid.body));
});

shortlistRouter.get('/export.csv', validate({ params: projectParams }), async (req, res) => {
  const { csv, fileName } = await shortlist.exportShortlistCsv(req.auth, req.valid.params.projectId);
  res
    .set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${fileName}"` })
    .send(`﻿${csv}`); // BOM so Excel reads UTF-8 names correctly
});

shortlistRouter.delete('/:candidateId', validate({ params: entryParams }), async (req, res) => {
  const { projectId, candidateId } = req.valid.params;
  res.json(await shortlist.removeFromShortlist(req.auth, projectId, candidateId));
});
