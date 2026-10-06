import { createApp } from './app.js';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './db/connection.js';
import { seedDatabase } from './db/seed.js';
import { logger } from './lib/logger.js';
import { resumePendingEvaluations, stopEvaluationWorker } from './modules/evaluations/evaluations.worker.js';

async function main() {
  await connectDatabase();
  await seedDatabase();
  await resumePendingEvaluations();

  const server = createApp().listen(env.PORT, () => {
    logger.info('server_started', { port: env.PORT, env: env.NODE_ENV });
  });

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutdown_started', { signal });
    stopEvaluationWorker();

    // Stop accepting connections. SSE/streaming responses never go idle on their
    // own, so close everything still open after a short grace period.
    server.close(async () => {
      await disconnectDatabase();
      logger.info('shutdown_complete');
      process.exit(0);
    });
    server.closeIdleConnections();
    setTimeout(() => server.closeAllConnections(), 5_000).unref();
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

process.on('unhandledRejection', (reason) => {
  logger.error('unhandled_rejection', { err: reason instanceof Error ? reason : new Error(String(reason)) });
});

main().catch((err) => {
  logger.error('startup_failed', { err });
  process.exit(1);
});
