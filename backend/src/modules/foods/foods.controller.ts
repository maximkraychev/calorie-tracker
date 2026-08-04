import type { Request, Response } from 'express';

import { searchQuerySchema } from './foods.schema.js';
import * as foodsService from './foods.service.js';

export async function searchFoods(req: Request, res: Response) {
  const { q, limit } = searchQuerySchema.parse(req.query);
  const items = await foodsService.searchFoods(q, limit);
  res.json({ items });
}
