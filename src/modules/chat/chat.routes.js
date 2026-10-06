import { Router } from 'express';
import { z } from 'zod';
import { logger } from '../../lib/logger.js';
import { chatLimiter } from '../../middleware/rateLimits.js';
import { objectId, validate } from '../../middleware/validate.js';
import { getOwnedSearch } from '../searches/searches.service.js';
import { runChatTurn } from './chat.service.js';

export const chatRouter = Router({ mergeParams: true });

const params = z.object({ searchId: objectId });
const body = z.object({ text: z.string().trim().min(1).max(2000) });

/**
 * POST /api/searches/:searchId/chat
 * Responds with application/x-ndjson: one JSON event per line, flushed as it is produced.
 */
chatRouter.post('/', chatLimiter, validate({ params, body }), async (req, res) => {
  // Validate and load before sending headers, so these errors are normal JSON responses.
  const search = await getOwnedSearch(req.auth, req.valid.params.searchId);

  const controller = new AbortController();
  // Use the *response* close event: on modern Node, req 'close' fires as soon as
  // the request body is read. If the client disconnects, stop the work.
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });

  res.status(200).set({
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no', // stop nginx from buffering the stream
  });
  res.flushHeaders();

  try {
    for await (const event of runChatTurn({ search, text: req.valid.body.text, signal: controller.signal })) {
      res.write(`${JSON.stringify(event)}\n`);
    }
  } catch (error) {
    if (controller.signal.aborted) return; // client went away: nothing to report
    // Headers are already sent, so the error has to travel inside the stream.
    logger.error('chat_stream_failed', { requestId: req.id, err: error });
    res.write(`${JSON.stringify({ type: 'error', message: 'The assistant failed to respond. Please try again.' })}\n`);
  } finally {
    res.end();
  }
});
