import type { Request, Response } from 'express';

import { recipeBodySchema, recipeIdSchema, recipeListQuerySchema } from './recipes.schema.js';
import * as recipesService from './recipes.service.js';

// Bare entities and arrays, matching the custom-food handlers (ARCHITECTURE.md §4.2/§4.3)
// — a CRUD collection has nothing to wrap it in.

export async function listRecipes(req: Request, res: Response) {
  const { q } = recipeListQuerySchema.parse(req.query);
  const items = await recipesService.listRecipes(req.userId!, q);
  res.json(items);
}

export async function createRecipe(req: Request, res: Response) {
  const body = recipeBodySchema.parse(req.body);
  const recipe = await recipesService.createRecipe(req.userId!, body);
  res.status(201).json(recipe);
}

export async function getRecipe(req: Request, res: Response) {
  const { id } = recipeIdSchema.parse(req.params);
  const recipe = await recipesService.getRecipe(req.userId!, id);
  res.json(recipe);
}

export async function updateRecipe(req: Request, res: Response) {
  const { id } = recipeIdSchema.parse(req.params);
  const body = recipeBodySchema.parse(req.body);
  const recipe = await recipesService.updateRecipe(req.userId!, id, body);
  res.json(recipe);
}

export async function deleteRecipe(req: Request, res: Response) {
  const { id } = recipeIdSchema.parse(req.params);
  await recipesService.deleteRecipe(req.userId!, id);
  res.status(204).end();
}
