import { Router } from 'express';
import { z } from 'zod';
import { objectId, validate } from '../../middleware/validate.js';
import * as projects from './projects.service.js';
import * as searches from '../searches/searches.service.js';
import { shortlistRouter } from '../shortlist/shortlist.routes.js';

export const projectsRouter = Router();

const projectParams = z.object({ projectId: objectId });
const projectBody = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).default(''),
});

projectsRouter.get('/', async (req, res) => {
  res.json(await projects.listProjects(req.auth));
});

projectsRouter.post('/', validate({ body: projectBody }), async (req, res) => {
  res.status(201).json(await projects.createProject(req.auth, req.valid.body));
});

projectsRouter.get('/:projectId', validate({ params: projectParams }), async (req, res) => {
  res.json(await projects.getProjectDetail(req.auth, req.valid.params.projectId));
});

projectsRouter.patch(
  '/:projectId',
  validate({ params: projectParams, body: projectBody.partial().refine((b) => Object.keys(b).length > 0, 'Nothing to update') }),
  async (req, res) => {
    res.json(await projects.updateProject(req.auth, req.valid.params.projectId, req.valid.body));
  },
);

projectsRouter.delete('/:projectId', validate({ params: projectParams }), async (req, res) => {
  await projects.deleteProject(req.auth, req.valid.params.projectId);
  res.status(204).end();
});

// Searches are created inside a project; everything else about them lives under /api/searches.
projectsRouter.post(
  '/:projectId/searches',
  validate({ params: projectParams, body: z.object({ title: z.string().trim().min(1).max(120).optional() }) }),
  async (req, res) => {
    res.status(201).json(await searches.createSearch(req.auth, req.valid.params.projectId, req.valid.body.title));
  },
);

projectsRouter.use('/:projectId/shortlist', shortlistRouter);
