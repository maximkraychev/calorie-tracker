import { Router } from 'express';

import { requireAuth } from '../../middleware/require-auth.js';
import {
  createRecipe,
  deleteRecipe,
  getRecipe,
  listRecipes,
  updateRecipe,
} from './recipes.controller.js';

export const recipesRouter = Router();

// Every route here is user-scoped — a recipe belongs to exactly one account.
recipesRouter.use(requireAuth);

recipesRouter.get('/', listRecipes);
recipesRouter.post('/', createRecipe);
recipesRouter.get('/:id', getRecipe);
recipesRouter.put('/:id', updateRecipe);
recipesRouter.delete('/:id', deleteRecipe);
