import { Router } from 'express';

import { requireAuth } from '../../middleware/require-auth.js';
import { getGoal, saveGoal } from './goals.controller.js';

export const goalsRouter = Router();

// Goals are per-user — auth required.
goalsRouter.use(requireAuth);

// No `:id` routes: a goal is addressed by the date it applies to, never by its own id.
// PUT (not POST) because saving is an idempotent upsert of one day's targets.
goalsRouter.get('/', getGoal);
goalsRouter.put('/', saveGoal);
