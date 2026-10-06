import { setTimeout as delay } from 'node:timers/promises';
import mongoose from 'mongoose';
import { env } from '../../config/env.js';
import { Evaluation, Search } from '../../db/models/index.js';
import { evaluateCandidate } from '../../engine/evaluator.js';
import { channels, publish } from '../../lib/eventBus.js';
import { logger } from '../../lib/logger.js';
import { findCandidateById } from '../candidates/candidates.repository.js';

/**
 * In-process job queue with bounded concurrency. Jobs survive restarts because
 * their state lives in Mongo (status = queued/running) and resumePendingEvaluations()
 * re-enqueues them on boot. In production this would be BullMQ on Redis.
 */
const CONCURRENCY = 3;
const queue = [];
let active = 0;
let stopped = false;

export function enqueueEvaluation(job) {
  queue.push(job);
  pump();
}

function pump() {
  while (!stopped && active < CONCURRENCY && queue.length > 0) {
    const job = queue.shift();
    active++;
    runJob(job)
      .catch((err) => logger.error('evaluation_job_failed', { ...job, err }))
      .finally(() => {
        active--;
        pump();
      });
  }
}

async function runJob({ searchId, candidateId }) {
  await Evaluation.updateOne({ searchId, candidateId }, { $set: { status: 'running' } });
  await publishUpdate(searchId, candidateId);

  // Simulates model latency so progress is visible; jittered so results arrive out of order.
  await delay(env.EVALUATION_DELAY_MS * (0.5 + Math.random()));

  const [search, candidate] = await Promise.all([Search.findById(searchId).lean(), findCandidateById(candidateId)]);
  if (!search) return; // search deleted while queued; its evaluations were deleted with it

  try {
    if (!candidate) throw new Error('Candidate not found');
    const { score, verdict, checks } = evaluateCandidate(candidate, search.criteria);
    await Evaluation.updateOne({ searchId, candidateId }, { $set: { status: 'done', score, verdict, checks } });
  } catch (err) {
    logger.error('evaluation_failed', { searchId: String(searchId), candidateId: String(candidateId), err });
    await Evaluation.updateOne({ searchId, candidateId }, { $set: { status: 'failed' } });
  }
  await publishUpdate(searchId, candidateId);
}

export async function getProgress(searchId) {
  // Aggregation pipelines skip Mongoose casting, so the id must already be an ObjectId.
  const id = new mongoose.Types.ObjectId(String(searchId));
  const counts = await Evaluation.aggregate([{ $match: { searchId: id } }, { $group: { _id: '$status', count: { $sum: 1 } } }]);
  const by = Object.fromEntries(counts.map((row) => [row._id, row.count]));
  return {
    pending: (by.queued ?? 0) + (by.running ?? 0),
    done: by.done ?? 0,
    failed: by.failed ?? 0,
  };
}

async function publishUpdate(searchId, candidateId) {
  const [evaluation, progress] = await Promise.all([Evaluation.findOne({ searchId, candidateId }).lean(), getProgress(searchId)]);
  if (!evaluation) return;
  publish(channels.search(String(searchId)), {
    event: 'evaluation',
    data: {
      candidateId: String(candidateId),
      evaluation: { status: evaluation.status, score: evaluation.score, verdict: evaluation.verdict, checks: evaluation.checks, updatedAt: evaluation.updatedAt },
      progress,
    },
  });
}

/** Called on boot: anything left queued/running by a previous process is retried. */
export async function resumePendingEvaluations() {
  const pending = await Evaluation.find({ status: { $in: ['queued', 'running'] } }, { searchId: 1, candidateId: 1 }).lean();
  pending.forEach(({ searchId, candidateId }) => enqueueEvaluation({ searchId, candidateId }));
  if (pending.length) logger.info('evaluations_resumed', { count: pending.length });
}

/** Stops taking new jobs (graceful shutdown); in-flight jobs finish or are resumed next boot. */
export function stopEvaluationWorker() {
  stopped = true;
  queue.length = 0;
}
