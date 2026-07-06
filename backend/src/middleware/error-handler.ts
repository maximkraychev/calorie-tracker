import type { NextFunction, Request, Response } from 'express';
import { z, ZodError } from 'zod';

import { env } from '../config/env.js';
import { AppError } from '../utils/app-error.js';
import { logger } from '../utils/logger.js';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Validation failed', details: z.treeifyError(err) });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  logger.error({ err }, 'Unhandled error');
  res.status(500).json({
    error: env.NODE_ENV === 'production' ? 'Internal server error' : (err as Error).message,
  });
}
