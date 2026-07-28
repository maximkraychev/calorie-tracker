import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`Backend server running on http://localhost:${env.PORT}`);
  // Both of these degrade silently rather than erroring — 'stub' returns a fixed fake
  // meal, and a missing FDC key makes every ingredient fall back to the model's own
  // guess. Neither is visible from the response alone, so state them at boot.
  logger.info(
    {
      provider: env.PHOTO_AI_PROVIDER,
      model: env.PHOTO_AI_PROVIDER === 'gemini' ? env.GEMINI_MODEL : null,
      usdaMacros: env.FDC_API_KEY ? 'live' : 'NOT CONFIGURED — model guesses only',
    },
    'Photo estimation',
  );
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info(`${signal} received, shutting down`);
    server.close(() => process.exit(0));
  });
}
