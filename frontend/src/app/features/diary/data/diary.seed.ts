import { isoDateForOffset } from '../../../shared/utils/date.utils';
import type { LogEntry } from '../models/diary.models';

// Realistic starter data so the app opens on a populated "Today", matching the
// prototype. Replace with a backend fetch once the diary API exists.
export function seedDiary(): Record<string, LogEntry[]> {
  const today = isoDateForOffset(0);
  return {
    [today]: [
      {
        id: crypto.randomUUID(),
        mealType: 'breakfast',
        name: 'Overnight Oats',
        brand: 'Homemade',
        grams: 250,
        kcalPer100g: 170,
        proteinPer100g: 6,
        carbsPer100g: 28,
        fatPer100g: 4,
        source: 'custom',
      },
      {
        id: crypto.randomUUID(),
        mealType: 'breakfast',
        name: 'Banana',
        brand: null,
        grams: 120,
        kcalPer100g: 89,
        proteinPer100g: 1.1,
        carbsPer100g: 23,
        fatPer100g: 0.3,
        source: 'search',
      },
      {
        id: crypto.randomUUID(),
        mealType: 'lunch',
        name: 'Chicken Stir-Fry',
        brand: null,
        grams: 410,
        kcalPer100g: 110,
        proteinPer100g: 10.4,
        carbsPer100g: 12.1,
        fatPer100g: 3.2,
        source: 'recipe',
      },
      {
        id: crypto.randomUUID(),
        mealType: 'snack',
        name: 'Greek Yogurt 5%',
        brand: 'Fage',
        grams: 170,
        kcalPer100g: 97,
        proteinPer100g: 9,
        carbsPer100g: 4,
        fatPer100g: 5,
        source: 'custom',
      },
    ],
  };
}
