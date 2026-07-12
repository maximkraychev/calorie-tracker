import { Router } from 'express';

import { authRouter } from '../modules/auth/auth.router.js';
import { healthRouter } from '../modules/health/health.router.js';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
