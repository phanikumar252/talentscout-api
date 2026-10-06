import { randomUUID } from 'node:crypto';
import { logger } from '../lib/logger.js';

/** Tags each request with an id (echoed in X-Request-Id) and logs it on completion. */
export function requestContext(req, res, next) {
  const incoming = req.get('x-request-id');
  req.id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.set('X-Request-Id', req.id);

  const started = process.hrtime.bigint();
  res.on('finish', () => {
    logger.info('request', {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Number((process.hrtime.bigint() - started) / 1_000_000n),
      userId: req.auth?.userId,
    });
  });
  next();
}
