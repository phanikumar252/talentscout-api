import { Candidate } from '../../db/models/index.js';
import { buildCandidateFilter } from '../../engine/scoring.js';
import { leanToDto } from '../../db/plugins.js';

/** Candidates that can possibly match. Mongo narrows with indexes, then the engine scores. */
export async function findCandidatePool(criteria) {
  const docs = await Candidate.find(buildCandidateFilter(criteria)).lean();
  return docs.map(leanToDto);
}

export async function findCandidateById(candidateId) {
  return leanToDto(await Candidate.findById(candidateId).lean());
}

export async function findCandidatesByIds(candidateIds) {
  const docs = await Candidate.find({ _id: { $in: candidateIds } }).lean();
  return docs.map(leanToDto);
}
