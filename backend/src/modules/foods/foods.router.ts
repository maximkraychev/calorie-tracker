import { Router } from 'express';

import { requireAuth } from '../../middleware/require-auth.js';
import {
  createFood,
  deleteFood,
  getFood,
  listFoods,
  searchFoods,
  updateFood,
} from './foods.controller.js';

export const foodsRouter = Router();

// The generic catalog is public-domain USDA data, but the endpoint still requires auth:
// it is a regex scan over 5,000 rows on a free-tier instance, and an open one is a free
// denial-of-service. The custom-food routes below are user-scoped regardless.
foodsRouter.use(requireAuth);

// Order matters. Express matches in registration order, so `/search` has to be declared
// before `/:id` or every search request would be parsed as a (malformed) uuid.
foodsRouter.get('/search', searchFoods);

foodsRouter.get('/', listFoods);
foodsRouter.post('/', createFood);
foodsRouter.get('/:id', getFood);
foodsRouter.put('/:id', updateFood);
foodsRouter.delete('/:id', deleteFood);
