import type { Request, Response } from 'express';

import {
  customFoodBodySchema,
  customFoodListQuerySchema,
  foodIdSchema,
  searchQuerySchema,
} from './foods.schema.js';
import * as foodsService from './foods.service.js';

export async function searchFoods(req: Request, res: Response) {
  const { q, limit } = searchQuerySchema.parse(req.query);
  const items = await foodsService.searchFoods(q, limit);
  res.json({ items });
}

// The custom-food handlers below return bare entities/arrays (ARCHITECTURE.md §4.2),
// unlike `searchFoods` above which wraps in `{ items }` — search may grow facets or a
// total; a CRUD collection will not.

export async function listFoods(req: Request, res: Response) {
  const { q } = customFoodListQuerySchema.parse(req.query);
  const foods = await foodsService.listCustomFoods(req.userId!, q);
  res.json(foods);
}

export async function createFood(req: Request, res: Response) {
  const body = customFoodBodySchema.parse(req.body);
  const food = await foodsService.createCustomFood(req.userId!, body);
  res.status(201).json(food);
}

export async function getFood(req: Request, res: Response) {
  const { id } = foodIdSchema.parse(req.params);
  const food = await foodsService.getCustomFood(req.userId!, id);
  res.json(food);
}

export async function updateFood(req: Request, res: Response) {
  const { id } = foodIdSchema.parse(req.params);
  const body = customFoodBodySchema.parse(req.body);
  const food = await foodsService.updateCustomFood(req.userId!, id, body);
  res.json(food);
}

export async function deleteFood(req: Request, res: Response) {
  const { id } = foodIdSchema.parse(req.params);
  await foodsService.deleteCustomFood(req.userId!, id);
  res.status(204).end();
}
