import mongoose from 'mongoose';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` } });
}

/** Maps every error to one JSON shape: { error: { code, message, details?, requestId? } }. */
// Express identifies error middleware by its 4 arguments, so `next` must stay.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    // Streaming responses report errors in-band; all we can do here is close.
    logger.error('error_after_headers_sent', { requestId: req.id, err });
    return res.end();
  }

  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } });
  }
  if (err instanceof mongoose.Error.ValidationError) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: err.message } });
  }
  if (err instanceof mongoose.Error.CastError) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: `Invalid ${err.path}` } });
  }
  if (err?.code === 11000) {
    return res.status(409).json({ error: { code: 'CONFLICT', message: 'Duplicate record' } });
  }

  logger.error('unhandled_error', { requestId: req.id, err });
  return res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong', requestId: req.id } });
}
