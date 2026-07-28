import { PROMPT_VERSION } from './prompt.v1.js';
import type { EstimateInput, PhotoEstimateProvider, VisionResult } from './types.js';

// Fixed result, no network. Lets the whole path — multipart upload, FDC resolution,
// the editable review list, the diary save — be built and driven end to end without an
// API key or a per-call cost. Default provider (PHOTO_AI_PROVIDER=stub).
//
// The search terms are real so FDC resolution genuinely exercises itself against them.
export const stubProvider: PhotoEstimateProvider = {
  name: 'stub',
  promptVersion: PROMPT_VERSION,

  estimate(input: EstimateInput): Promise<VisionResult> {
    const bg = input.locale === 'bg';
    return Promise.resolve({
      items: [
        {
          displayName: bg ? 'Пилешко филе на скара' : 'Grilled chicken breast',
          searchTerm: 'chicken breast',
          grams: 150,
          confidence: 'high',
          cookingMethod: 'grilled',
          fallbackPer100g: { kcal: 165, protein: 31, carbs: 0, fat: 3.6 },
        },
        {
          displayName: bg ? 'Бял ориз, варен' : 'White rice, cooked',
          searchTerm: 'white rice cooked',
          grams: 180,
          confidence: 'medium',
          cookingMethod: 'boiled',
          fallbackPer100g: { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 },
        },
        {
          displayName: bg ? 'Слънчогледово олио' : 'Sunflower oil',
          searchTerm: 'sunflower oil',
          grams: 7,
          confidence: 'low',
          cookingMethod: null,
          fallbackPer100g: { kcal: 884, protein: 0, carbs: 0, fat: 100 },
        },
      ],
      scaleReferenceUsed: 'standard 26 cm dinner plate',
      hiddenFatsNote: bg
        ? 'Предполага се 1 ч.л. олио за печенето.'
        : 'Assumed 1 tsp of oil for grilling.',
      overallConfidence: 'medium',
      clarifyingQuestion: bg
        ? 'Оризът приготвен ли е с масло или олио?'
        : 'Was the rice cooked with any butter or oil?',
    });
  },
};
