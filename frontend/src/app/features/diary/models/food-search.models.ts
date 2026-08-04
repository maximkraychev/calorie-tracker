import type { Per100g } from '../../../shared/utils/nutrition.utils';
import type { Language } from '../../../core/i18n/translations';

/** A household measure for a generic food, e.g. `1 medium (7" to 7-7/8" long)` → 118 g. */
export interface FoodPortion {
  label: string;
  grams: number;
}

// One search hit, normalized to the app's per-100g shape. Logging it snapshots these
// values into a LogEntry, so results are never stored as-is.
//
// Two sources produce this shape and are interchangeable everywhere downstream:
//   'search'  — Open Food Facts, queried browser-direct. Packaged, branded products.
//   'generic' — our own USDA-seeded catalog, via GET /api/foods/search. Whole foods,
//               which OFF barely covers because it is fundamentally a barcode database.
export interface FoodSearchResult extends Per100g {
  /**
   * Stable list key. An OFF barcode, or `usda:<fdcId>` for a generic food — prefixed
   * because the two are different namespaces and a bare fdcId could collide with a
   * barcode once the two lists are merged.
   */
  code: string;
  name: string;
  /**
   * Bulgarian name when the catalog has one, else null. Both names travel together and
   * the UI resolves by locale, so switching language re-labels the list without another
   * request.
   */
  nameBg?: string | null;
  brand: string | null;
  source: 'search' | 'generic';
  /** Serving size in grams, when the source publishes one. */
  servingSizeG?: number | null;
  /** Household measures, offered as grams presets. Generic foods only. */
  portions?: FoodPortion[];
}

/** The name to show for the active language, falling back to English. */
export function displayName(result: FoodSearchResult, lang: Language): string {
  if (lang === 'bg') {
    const bg = result.nameBg?.trim();
    if (bg) return bg;
  }
  return result.name;
}
