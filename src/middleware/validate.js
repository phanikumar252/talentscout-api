import { z } from 'zod';
import { badRequest } from '../lib/errors.js';

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

/**
 * Validates and coerces request parts with Zod. Parsed values land on
 * `req.valid` (Express 5 makes req.query read-only, so it is not overwritten).
 *
 * @param {{ params?: z.ZodTypeAny, query?: z.ZodTypeAny, body?: z.ZodTypeAny }} schemas
 */
export const validate = (schemas) => (req, _res, next) => {
  req.valid = {};
  for (const part of ['params', 'query', 'body']) {
    const schema = schemas[part];
    if (!schema) continue;
    const result = schema.safeParse(req[part] ?? {});
    if (!result.success) {
      return next(badRequest(`Invalid request ${part}`, result.error.flatten()));
    }
    req.valid[part] = result.data;
  }
  return next();
};
