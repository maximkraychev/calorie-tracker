// Provider-agnostic contract for photo → ingredient estimation (ARCHITECTURE.md §6).
// Swapping providers touches nothing but a new adapter in this folder — not routes,
// not the schema, not the frontend contract.

export interface Per100g {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export type Confidence = 'high' | 'medium' | 'low';

/**
 * One ingredient as the vision model sees it.
 *
 * The model estimates **grams, never calories** — macros come from USDA FDC. Weight
 * estimation is the one thing a vision model contributes that a database cannot, and
 * keeping nutrition out of its output makes every later edit plain arithmetic
 * (`grams / 100 × per100g`) instead of a re-inference.
 */
export interface VisionItem {
  /** Shown in the UI, in the user's locale (may be Cyrillic). */
  displayName: string;
  /**
   * The FDC query: English, singular, database-friendly. Cyrillic here is a
   * prompt-adherence bug — FDC is English-only.
   */
  searchTerm: string;
  grams: number;
  confidence: Confidence;
  /** e.g. "grilled", "deep-fried" — context for the reviewer, not used in lookup. */
  cookingMethod: string | null;
  /**
   * The model's own guess, used **only** when FDC resolution fails. Never the primary
   * source: published MAPE is ~36% for energy and >60% for protein when vision models
   * estimate nutrients directly.
   */
  fallbackPer100g: Per100g;
}

export interface VisionResult {
  items: VisionItem[];
  /** Which visible reference the model scaled from (plate, cutlery, hand, can). */
  scaleReferenceUsed: string | null;
  /** Stated assumption about oil/butter/dressing — the worst under-reported failure. */
  hiddenFatsNote: string | null;
  overallConfidence: Confidence;
  /** One specific, answerable question in the user's locale, when confidence is low. */
  clarifyingQuestion: string | null;
}

export interface EstimateInput {
  image: { data: Buffer; mimeType: string };
  /**
   * Free-text user context. Treated as authoritative where it contradicts the photo.
   * Explicitly `| undefined` because the project compiles with exactOptionalPropertyTypes.
   */
  note?: string | undefined;
  locale: 'bg' | 'en';
}

export interface PhotoEstimateProvider {
  readonly name: string;
  /** Prompt version, logged per analysis so results stay replayable across prompt edits. */
  readonly promptVersion: string;
  estimate(input: EstimateInput): Promise<VisionResult>;
}
