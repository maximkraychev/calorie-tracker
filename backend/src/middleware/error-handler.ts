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

  // express.json() throws a SyntaxError with status 400 on unparseable bodies.
  if (err instanceof SyntaxError && 'status' in err && err.status === 400) {
    res.status(400).json({ error: 'Invalid JSON body' });
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
