import { Router } from 'express';

import { requireAuth } from '../../middleware/require-auth.js';
import { createEntries, deleteEntry, getDiary, updateEntry } from './diary.controller.js';

export const diaryRouter = Router();

// Every diary route is user-scoped — auth required.
diaryRouter.use(requireAuth);

diaryRouter.get('/', getDiary);
diaryRouter.post('/entries', createEntries);
diaryRouter.patch('/entries/:id', updateEntry);
diaryRouter.delete('/entries/:id', deleteEntry);
