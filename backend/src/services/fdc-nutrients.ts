// Reading nutrition out of a USDA FoodData Central food record.
//
// Split out of `fdc.ts` so the offline importer (`scripts/import-generic-foods.ts`) can
// reuse the exact same energy priority and range check as the live API client without
// pulling in `config/env.ts`, which validates process.env and exits on anything missing.
// Two copies of this logic would drift, and the failure mode is silent (see below).

import type { Per100g } from './photo-estimate/types.js';

/** Nutrients are identified by both a legacy number and a modern id; entries in the wild
 * carry one or the other, so match on either. */
export const NUTRIENTS = {
  protein: { numbers: ['203'], ids: [1003] },
  fat: { numbers: ['204'], ids: [1004] },
  carbs: { numbers: ['205'], ids: [1005] },
} as const;

// Energy is the one nutrient FDC reports inconsistently across data types, and getting
// this wrong is silent: a food with no readable energy is dropped entirely, which
// quietly reduced the whole result set to SR Legacy and handed generic queries to
// whatever processed derivative SR Legacy ranked first.
//
// Tried in order:
//   208 — "Energy", what SR Legacy publishes.
//   957 — "Energy (Atwater General Factors)", what Foundation publishes instead. Same
//         basis as 208, so the two data types stay comparable in one ranking.
//   958 — "Energy (Atwater Specific Factors)", per-food factors. Present on most
//         Foundation entries alongside 957; a few carry only this one.
//   268 — kilojoules, converted. Last resort.
export const ENERGY_SOURCES = [
  { numbers: ['208'], ids: [1008] },
  { numbers: ['957'], ids: [2047] },
  { numbers: ['958'], ids: [2048] },
] as const;

export const ENERGY_KJ = { numbers: ['268'], ids: [1062] } as const;
const KJ_PER_KCAL = 4.184;

export interface FdcNutrient {
  nutrientId?: number;
  nutrientNumber?: string;
  unitName?: string;
  value?: number;
  // The /food/{id} detail endpoint and the bulk downloads nest these; /foods/search
  // flattens them. Both shapes are read below.
  nutrient?: { id?: number; number?: string; unitName?: string };
  amount?: number;
}

export interface NutrientSpec {
  numbers: readonly string[];
  ids: readonly number[];
}

/** Energy in kcal, or null when the record publishes none of the four sources above. */
export function readEnergy(nutrients: FdcNutrient[]): number | null {
  for (const source of ENERGY_SOURCES) {
    const kcal = readNutrient(nutrients, source);
    if (kcal !== null) return kcal;
  }

  const kj = readNutrient(nutrients, ENERGY_KJ);
  return kj === null ? null : round2(kj / KJ_PER_KCAL);
}

/**
 * Read a macro, floored at zero. FDC derives carbohydrate "by difference", so a food
 * that is almost entirely protein, fat and water can land slightly below zero — raw
 * chicken breast reports -0.43 g. That is a rounding artefact, not corrupt data, and
 * rejecting the whole food over it (which `inRange` would) loses a good match.
 */
export function readMacro(nutrients: FdcNutrient[], spec: NutrientSpec): number {
  return Math.max(0, readNutrient(nutrients, spec) ?? 0);
}

export function readNutrient(nutrients: FdcNutrient[], spec: NutrientSpec): number | null {
  for (const entry of nutrients) {
    const number = entry.nutrientNumber ?? entry.nutrient?.number;
    const id = entry.nutrientId ?? entry.nutrient?.id;
    const matches =
      (number !== undefined && spec.numbers.includes(number)) ||
      (id !== undefined && spec.ids.includes(id));
    if (!matches) continue;

    const value = entry.value ?? entry.amount;
    if (typeof value === 'number' && Number.isFinite(value)) return round2(value);
  }
  return null;
}

/**
 * The same bounds the `per100gChecks` CHECK constraints enforce (kcal ≤ 900, each macro
 * ≤ 100 g). A value outside them is corrupt rather than merely extreme — pure oil is
 * 884/0/0/100 and passes — so callers reject the food instead of clamping it into
 * plausibility.
 */
export function inRange({ kcal, protein, carbs, fat }: Per100g): boolean {
  return (
    kcal >= 0 && kcal <= 900 && [protein, carbs, fat].every((macro) => macro >= 0 && macro <= 100)
  );
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
