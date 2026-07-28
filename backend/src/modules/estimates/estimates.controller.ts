import type { Request, Response } from 'express';

import { AppError } from '../../utils/app-error.js';
import { analyzeBodySchema, foodSearchQuerySchema } from './estimates.schema.js';
import * as estimatesService from './estimates.service.js';

export async function analyzePhoto(req: Request, res: Response) {
  const file = req.file;
  if (!file) throw new AppError('A photo is required', 400);

  const body = analyzeBodySchema.parse(req.body);
  const estimate = await estimatesService.analyzePhoto(
    { data: file.buffer, mimeType: file.mimetype },
    body,
  );
  res.json(estimate);
}

export async function searchFoods(req: Request, res: Response) {
  const { q } = foodSearchQuerySchema.parse(req.query);
  const foods = await estimatesService.searchFoods(q);
  res.json(foods);
}
