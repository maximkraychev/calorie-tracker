import { Router } from 'express';

import { requireAuth } from '../../middleware/require-auth.js';
import { searchFoods } from './foods.controller.js';

export const foodsRouter = Router();

// The catalog is public-domain USDA data, but the endpoint still requires auth: it is a
// regex scan over 5,000 rows on a free-tier instance, and an open one is a free
// denial-of-service. Custom foods and recipes will hang off this same router and are
// user-scoped regardless.
foodsRouter.use(requireAuth);

foodsRouter.get('/search', searchFoods);
