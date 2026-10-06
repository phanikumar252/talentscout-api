import { CandidateSummary, Evaluation, ShortlistEntry } from '../../db/models/index.js';
import { rankCandidates, scoreCandidate } from '../../engine/scoring.js';
import { writeCandidateSummary } from '../../engine/writer.js';
import { notFound } from '../../lib/errors.js';
import { chargeOnce } from '../credits/credits.service.js';
import { getOwnedSearch } from '../searches/searches.service.js';
import { findCandidateById, findCandidatePool } from './candidates.repository.js';

const SUMMARY_COST = 1;

const toEvaluationDto = (evaluation) =>
  evaluation && {
    status: evaluation.status,
    score: evaluation.score,
    verdict: evaluation.verdict,
    checks: evaluation.checks,
    updatedAt: evaluation.updatedAt,
  };

/** Paginated, ranked results for a search, annotated with shortlist and evaluation state. */
export async function listCandidatesForSearch(auth, searchId, { page, pageSize }) {
  const search = await getOwnedSearch(auth, searchId);
  const criteria = search.criteria.toObject();
  const ranked = rankCandidates(await findCandidatePool(criteria), criteria);

  const start = (page - 1) * pageSize;
  const pageEntries = ranked.slice(start, start + pageSize);
  const ids = pageEntries.map((entry) => entry.candidate.id);

  // Batched lookups for the whole page, not one query per candidate.
  const [shortlisted, evaluations, summaries] = await Promise.all([
    ShortlistEntry.find({ projectId: search.projectId, candidateId: { $in: ids } }).distinct('candidateId'),
    Evaluation.find({ searchId: search._id, candidateId: { $in: ids } }).lean(),
    CandidateSummary.find({ searchId: search._id, candidateId: { $in: ids } }).distinct('candidateId'),
  ]);
  const shortlistedSet = new Set(shortlisted.map(String));
  const summarySet = new Set(summaries.map(String));
  const evaluationById = new Map(evaluations.map((evaluation) => [String(evaluation.candidateId), evaluation]));

  return {
    items: pageEntries.map(({ candidate, match }) => ({
      ...candidate,
      match,
      shortlisted: shortlistedSet.has(candidate.id),
      hasSummary: summarySet.has(candidate.id),
      evaluation: toEvaluationDto(evaluationById.get(candidate.id)) ?? null,
    })),
    total: ranked.length,
    page,
    pageSize,
  };
}

/**
 * POST (not GET) because it can spend a credit. A summary that already exists
 * for this search + candidate is returned for free.
 */
export async function getOrCreateSummary(auth, searchId, candidateId) {
  const search = await getOwnedSearch(auth, searchId);
  const existing = await CandidateSummary.findOne({ searchId: search._id, candidateId }).lean();
  if (existing) return { summary: existing.content, charged: false };

  const candidate = await findCandidateById(candidateId);
  if (!candidate) throw notFound('Candidate');

  const { charged, balance } = await chargeOnce(auth.userId, {
    reason: 'candidate_summary',
    reference: `${search._id}:${candidate.id}`,
    amount: SUMMARY_COST,
  });

  const criteria = search.criteria.toObject();
  const content = writeCandidateSummary(candidate, criteria, scoreCandidate(candidate, criteria));
  // Upsert: two concurrent requests for the same summary converge on one document.
  await CandidateSummary.updateOne({ searchId: search._id, candidateId }, { $setOnInsert: { content } }, { upsert: true });

  return { summary: content, charged, credits: balance };
}
