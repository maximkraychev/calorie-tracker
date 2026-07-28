import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  // Deployed frontend origin (e.g. https://my-app.onrender.com). Unset in dev,
  // where CORS reflects the caller instead.
  CORS_ORIGIN: z.url().optional(),
  DATABASE_URL: z.url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  // AI photo estimation. 'stub' returns a fixed result with no network calls, so the
  // whole flow is buildable and testable without a key or a per-call cost.
  PHOTO_AI_PROVIDER: z.enum(['stub', 'gemini']).default('stub'),
  GEMINI_API_KEY: z.string().min(1).optional(),
  // Google renames these often (gemini-3-flash-preview, gemini-3.1-flash-lite, ...).
  // List the current ids: GET https://generativelanguage.googleapis.com/v1beta/models
  GEMINI_MODEL: z.string().min(1).default('gemini-3-flash-preview'),
  // USDA FoodData Central — free key, 1000 req/hour: https://fdc.nal.usda.gov/api-key-signup
  FDC_API_KEY: z.string().min(1).optional(),
});

const parsed = envSchema
  // Fail at boot rather than at the first photo upload: a missing key here is a
  // deployment mistake, and it is much cheaper to find on startup.
  .superRefine((value, ctx) => {
    if (value.PHOTO_AI_PROVIDER === 'gemini' && !value.GEMINI_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['GEMINI_API_KEY'],
        message: 'Required when PHOTO_AI_PROVIDER=gemini',
      });
    }
  })
  .safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', z.treeifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
