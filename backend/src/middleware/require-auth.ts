import type { NextFunction, Request, Response } from 'express';

import { verifyAccessToken } from '../services/tokens.js';
import { AppError } from '../utils/app-error.js';

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;

  const userId = token ? await verifyAccessToken(token) : null;
  if (!userId) {
    throw new AppError('Unauthorized', 401);
  }

  req.userId = userId;
  next();
}
