import { Evaluation } from '../../db/models/index.js';
import { badRequest } from '../../lib/errors.js';
import { findCandidatesByIds } from '../candidates/candidates.repository.js';
import { getOwnedSearch } from '../searches/searches.service.js';
import { enqueueEvaluation, getProgress } from './evaluations.worker.js';

/** Queues evaluations; candidates already queued or running are skipped. Returns 202-style info. */
export async function startEvaluations(auth, searchId, candidateIds) {
  const search = await getOwnedSearch(auth, searchId);
  const uniqueIds = [...new Set(candidateIds)];
  const found = await findCandidatesByIds(uniqueIds);
  if (found.length !== uniqueIds.length) throw badRequest('One or more candidates do not exist');

  const inFlight = await Evaluation.find({ searchId: search._id, candidateId: { $in: uniqueIds }, status: { $in: ['queued', 'running'] } }).distinct('candidateId');
  const inFlightSet = new Set(inFlight.map(String));
  const toQueue = uniqueIds.filter((id) => !inFlightSet.has(id));

  if (toQueue.length) {
    // Upsert resets earlier results so a re-run reflects the current criteria.
    await Evaluation.bulkWrite(
      toQueue.map((candidateId) => ({
        updateOne: {
          filter: { searchId: search._id, candidateId },
          update: { $set: { status: 'queued', score: null, verdict: null, checks: [] } },
          upsert: true,
        },
      })),
    );
    toQueue.forEach((candidateId) => enqueueEvaluation({ searchId: search._id, candidateId }));
  }

  return { queued: toQueue.length, skipped: uniqueIds.length - toQueue.length, progress: await getProgress(search._id) };
}

export async function getEvaluationProgress(auth, searchId) {
  const search = await getOwnedSearch(auth, searchId);
  return { search, progress: await getProgress(search._id) };
}
