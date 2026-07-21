import type { TranslationKey } from '../../../core/i18n/translations';
import type { Portion } from '../../../shared/utils/nutrition.utils';

// The four meal buckets a diary day is split into, in display order.
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export const MEAL_ORDER: readonly MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export const MEAL_LABEL_KEYS: Record<MealType, TranslationKey> = {
  breakfast: 'meal.breakfast',
  lunch: 'meal.lunch',
  dinner: 'meal.dinner',
  snack: 'meal.snack',
};

// Where a logged food came from. Nutrition is snapshotted at log time regardless of
// source, so later edits to a custom food/recipe never touch past entries.
export type FoodSource = 'search' | 'barcode' | 'ai' | 'recipe' | 'custom' | 'manual';

// A single logged food: grams eaten + the per-100g nutrition copied in when logged.
export interface LogEntry extends Portion {
  id: string;
  mealType: MealType;
  name: string;
  brand: string | null;
  source: FoodSource;
}

// A meal's entries plus its kcal subtotal — the shape the diary page renders per section.
export interface MealSection {
  type: MealType;
  entries: LogEntry[];
  subtotalKcal: number;
}
