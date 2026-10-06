import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { env } from './config/env.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requestContext } from './middleware/requestContext.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { creditsRouter } from './modules/credits/credits.routes.js';
import { metaRouter } from './modules/meta/meta.routes.js';
import { projectsRouter } from './modules/projects/projects.routes.js';
import { searchesRouter } from './modules/searches/searches.routes.js';

/** Builds the Express app without listening, so tests can drive it with supertest. */
export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: env.corsOrigins, exposedHeaders: ['X-Request-Id', 'Content-Disposition'] }));
  app.use(express.json({ limit: '100kb' }));
  app.use(requestContext);

  // Liveness/readiness for the orchestrator (Kubernetes, ECS, etc.)
  app.get('/healthz', (_req, res) => {
    const dbReady = mongoose.connection.readyState === 1;
    res.status(dbReady ? 200 : 503).json({ status: dbReady ? 'ok' : 'degraded', db: dbReady ? 'up' : 'down' });
  });

  app.use('/api/auth', authRouter);

  // Everything below requires a valid token.
  app.use('/api', requireAuth);
  app.use('/api/credits', creditsRouter);
  app.use('/api/meta', metaRouter);
  app.use('/api/projects', projectsRouter);
  app.use('/api/searches', searchesRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
