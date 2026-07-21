import type { Per100g } from '../../../shared/utils/nutrition.utils';

// One product from the Open Food Facts search, normalized to the app's per-100g shape.
// Logging it snapshots these values into a LogEntry, so results are never stored as-is.
export interface FoodSearchResult extends Per100g {
  /** OFF barcode — identifies the product and keys the result list. */
  code: string;
  name: string;
  brand: string | null;
}
