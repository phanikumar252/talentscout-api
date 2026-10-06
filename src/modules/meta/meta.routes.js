import { Router } from 'express';
import { COMPANIES, LOCATIONS, SENIORITY, SKILLS, STARTUPS, TITLES } from '../../engine/vocabulary.js';

export const metaRouter = Router();

// The allowed values for hand-edited criteria. The UI reads them from here, so the
// list lives only in the backend.
const vocabulary = Object.freeze({
  titles: Object.keys(TITLES),
  skills: Object.keys(SKILLS).sort(),
  locations: Object.keys(LOCATIONS),
  seniority: Object.keys(SENIORITY),
  companies: [...Object.keys(COMPANIES), ...STARTUPS].sort(),
});

metaRouter.get('/vocabulary', (_req, res) => {
  res.set('Cache-Control', 'private, max-age=3600').json(vocabulary);
});
