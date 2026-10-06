import { env } from '../config/env.js';

// Minimal structured (JSON-lines) logger; swap for pino in a larger service.
function write(level, message, meta = {}) {
  if (env.isTest && level !== 'error') return;
  const { err, ...rest } = meta;
  const entry = {
    level,
    time: new Date().toISOString(),
    msg: message,
    ...rest,
    ...(err && { err: { name: err.name, message: err.message, stack: err.stack } }),
  };
  (level === 'error' ? console.error : console.log)(JSON.stringify(entry));
}

export const logger = {
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta),
};
