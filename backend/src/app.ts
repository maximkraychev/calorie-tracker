import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';

import { errorHandler } from './middleware/error-handler.js';
import { notFound } from './middleware/not-found.js';
import { apiRouter } from './routes/index.js';
import { logger } from './utils/logger.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  // credentials: true lets the browser send the httpOnly refresh cookie
  // cross-origin (Angular dev server). origin: true reflects the caller's
  // origin — lock this to the real frontend origin in production.
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());
  app.use(pinoHttp({ logger }));

  app.use('/api', apiRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
