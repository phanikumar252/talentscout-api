import { Router } from 'express';
import { z } from 'zod';
import { channels, subscribe } from '../../lib/eventBus.js';
import { objectId, validate } from '../../middleware/validate.js';
import * as evaluations from './evaluations.service.js';

export const evaluationsRouter = Router({ mergeParams: true });

const params = z.object({ searchId: objectId });
const startBody = z.object({ candidateIds: z.array(objectId).min(1).max(25) });
const HEARTBEAT_MS = 20_000;

evaluationsRouter.post('/', validate({ params, body: startBody }), async (req, res) => {
  // 202 Accepted: the work happens in the background; progress arrives on /stream.
  res.status(202).json(await evaluations.startEvaluations(req.auth, req.valid.params.searchId, req.valid.body.candidateIds));
});

/**
 * GET /api/searches/:searchId/evaluations/stream
 * Server-Sent Events: `snapshot` once, then an `evaluation` event per status change.
 */
evaluationsRouter.get('/stream', validate({ params }), async (req, res) => {
  const { search, progress } = await evaluations.getEvaluationProgress(req.auth, req.valid.params.searchId);

  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send('snapshot', { progress });

  const unsubscribe = subscribe(channels.search(String(search._id)), ({ event, data }) => send(event, data));
  // Comment lines keep proxies/load balancers from closing an idle connection.
  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);

  res.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});
