import type { Per100g, Portion } from '../../../shared/utils/nutrition.utils';

// Shapes for the AI photo-estimate flow. Like every other food shape in the app,
// nutrition is stored per 100 g and combined with grams — so `EstimateItem` is a
// `Portion` and `macrosOf(item)` works on it directly, with no conversion step.

export type EstimateConfidence = 'high' | 'medium' | 'low';

/** Another USDA match for the same ingredient — the "swap this food" options. */
export interface EstimateAlternative extends Per100g {
  fdcId: number;
  name: string;
}

export interface EstimateItem extends Portion {
  /** Unique within one estimate only — a list key, not a persisted id. */
  id: string;
  displayName: string;
  confidence: EstimateConfidence;
  /**
   * True when USDA had no usable match, so the per-100g values are the model's own
   * guess. Must be visually distinct in the UI: these numbers are unverified.
   */
  unresolved: boolean;
  fdcId: number | null;
  alternatives: EstimateAlternative[];
}

export interface PhotoEstimate {
  items: EstimateItem[];
  overallConfidence: EstimateConfidence;
  /** What the model scaled portions from ("standard 26 cm dinner plate"). */
  scaleReferenceUsed: string | null;
  /** Stated assumption about oil/butter/dressing — invisible in photos, easily missed. */
  hiddenFatsNote: string | null;
  /** One answerable question, in the user's language, when the model is unsure. */
  clarifyingQuestion: string | null;
}
