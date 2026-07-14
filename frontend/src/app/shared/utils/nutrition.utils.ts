// Pure nutrition math. Every logged entry stores per-100g values + grams, so all
// figures derive from `grams / 100 × per100g`. Kept dependency-free and exhaustively
// testable.

export interface Per100g {
  kcalPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
}

export interface Portion extends Per100g {
  grams: number;
}

export interface Macros {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

/** Absolute macros for a portion (grams of a per-100g food). */
export function macrosOf(portion: Portion): Macros {
  const factor = portion.grams / 100;
  return {
    kcal: portion.kcalPer100g * factor,
    protein: portion.proteinPer100g * factor,
    carbs: portion.carbsPer100g * factor,
    fat: portion.fatPer100g * factor,
  };
}

/** Sum macros across many portions (e.g. a day, or a meal). */
export function sumMacros(portions: readonly Portion[]): Macros {
  return portions.reduce<Macros>(
    (total, portion) => {
      const m = macrosOf(portion);
      total.kcal += m.kcal;
      total.protein += m.protein;
      total.carbs += m.carbs;
      total.fat += m.fat;
      return total;
    },
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

/** Round to whole number (used for kcal and summary macro grams). */
export function round(value: number): number {
  return Math.round(value);
}

/** Round to one decimal (used in finer preview strips). */
export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
