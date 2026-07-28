import { env } from '../../config/env.js';
import { geminiProvider } from './gemini.provider.js';
import { stubProvider } from './stub.provider.js';
import type { PhotoEstimateProvider } from './types.js';

const PROVIDERS: Record<typeof env.PHOTO_AI_PROVIDER, PhotoEstimateProvider> = {
  stub: stubProvider,
  gemini: geminiProvider,
};

/** The configured provider. Selection happens once — the choice can't change at runtime. */
export const photoEstimateProvider: PhotoEstimateProvider = PROVIDERS[env.PHOTO_AI_PROVIDER];

export type {
  Confidence,
  EstimateInput,
  Per100g,
  PhotoEstimateProvider,
  VisionItem,
  VisionResult,
} from './types.js';
