// Daily nutrition targets. They drive the diary's calorie ring, macro bars, and the
// "kcal left / over" readout; edited in the Daily Goals sheet.
export interface Goals {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

// Used until the user saves their own targets, and for any macro a stored goal leaves
// unset — the backend allows a calorie-only goal.
export const DEFAULT_GOALS: Goals = { kcal: 2200, protein: 140, carbs: 220, fat: 70 };

// Goals are effective-dated server-side: a saved goal applies from `effectiveDate`
// onward, so a past diary day is judged by the targets held then rather than today's.
export interface EffectiveGoals {
  effectiveDate: string;
  goals: Goals;
}

// The goal as the backend returns it (goals.service.ts `DailyGoal`). Macro targets are
// nullable there; they collapse onto the defaults on the way in.
export interface DailyGoalDto {
  effectiveDate: string;
  kcalTarget: number;
  proteinTargetG: number | null;
  carbsTargetG: number | null;
  fatTargetG: number | null;
}

/** Wire DTO -> the flat targets the UI works in. */
export function toGoals(dto: DailyGoalDto): Goals {
  return sanitizeGoals({
    kcal: dto.kcalTarget,
    protein: dto.proteinTargetG ?? undefined,
    carbs: dto.carbsTargetG ?? undefined,
    fat: dto.fatTargetG ?? undefined,
  });
}

// Upper bounds match the columns the targets land in: kcal_target is an integer, the
// macro targets are numeric(6,2). Clamping here means an absurd typed-in number is
// pinned to something storable instead of coming back as a 400 the sheet has no way to
// show — the real editing guardrails are the inputs themselves.
const KCAL_MAX = 100_000;
const MACRO_MAX = 9999.99;

/**
 * Fill in every target from a partial/untrusted source (localStorage, the wire, the
 * sheet's parsed inputs), falling back to the default for anything missing or invalid.
 */
export function sanitizeGoals(value: Partial<Goals> | null | undefined): Goals {
  return {
    // kcal is the divisor behind every macro percentage and the DB requires it to be a
    // positive integer, so 0 and fractions fall back rather than being stored.
    kcal: positiveInt(value?.kcal, DEFAULT_GOALS.kcal),
    protein: nonNegative(value?.protein, DEFAULT_GOALS.protein),
    carbs: nonNegative(value?.carbs, DEFAULT_GOALS.carbs),
    fat: nonNegative(value?.fat, DEFAULT_GOALS.fat),
  };
}

function positiveInt(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(Math.round(value), KCAL_MAX)
    : fallback;
}

function nonNegative(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(value, MACRO_MAX)
    : fallback;
}
