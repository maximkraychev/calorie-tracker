import type { Per100g } from '../../../shared/utils/nutrition.utils';

// A food the user created themselves — the only food catalog this app persists. Open
// Food Facts hits and USDA rows are looked up live and only ever snapshotted into a diary
// entry; these rows are owned, editable and deletable.
//
// Extending the flattened `Per100g` (rather than nesting a `per100g` object as the wire
// format does) is what lets `macrosOf({ ...food, grams })` work directly, and makes a
// custom food interchangeable with a `FoodSearchResult` in the Add-Food overlay.
export interface CustomFood extends Per100g {
  id: string;
  name: string;
  brand: string | null;
  /** Optional display serving. Grams stay the source of truth everywhere. */
  servingSizeG: number | null;
}

/** The fields a create or edit submits — a CustomFood minus its server-assigned id. */
export type NewCustomFood = Omit<CustomFood, 'id'>;

/**
 * Filter a catalog by a free-text query, matching name or brand.
 *
 * Client-side on purpose: a user has tens of custom foods, not thousands, so the whole
 * list is already loaded and filtering it in a `computed` is instant — no debounce, no
 * request per keystroke, no loading flicker. The API's `?q=` exists for the same job and
 * would be the fallback if a catalog ever grew past a screenful of scrolling.
 */
export function filterFoods(foods: readonly CustomFood[], query: string): CustomFood[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...foods];
  return foods.filter(
    (food) =>
      food.name.toLowerCase().includes(needle) || (food.brand?.toLowerCase().includes(needle) ?? false),
  );
}
