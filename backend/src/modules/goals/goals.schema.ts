import { z } from 'zod';

// Zod ranges mirror the DB CHECK constraints on goals (schema.ts:
// goals_kcal_target_positive + goals_macro_targets_non_negative) so a bad value is a 400
// here rather than a constraint violation surfacing as a 500 at the INSERT.

// numeric(6,2) columns top out at 9999.99; cap here so an oversized macro target is a
// 400, not a numeric-overflow 500. kcal_target is int4 — the cap is a sanity bound.
const NUMERIC_6_2_MAX = 9999.99;
const KCAL_TARGET_MAX = 100_000;

// Macro targets are optional in the DB: a user can track calories only, and clearing a
// macro field sends null rather than 0 (which would read as "zero grams of protein").
const macroTargetSchema = z.number().min(0).max(NUMERIC_6_2_MAX).nullish();

// PUT /api/goals — set the targets that apply from `effectiveDate` onward.
//
// `effectiveDate` is optional but the client always sends it: diary days are keyed by
// *local* ISO date, so the client is the authority on what "today" is. The server's own
// date is only a fallback (see goals.controller.ts).
export const saveGoalSchema = z.object({
  kcalTarget: z.number().int().positive().max(KCAL_TARGET_MAX),
  proteinTargetG: macroTargetSchema,
  carbsTargetG: macroTargetSchema,
  fatTargetG: macroTargetSchema,
  effectiveDate: z.iso.date().optional(),
});

// GET /api/goals?date= — the goal in force on that day (default: today).
export const goalQuerySchema = z.object({ date: z.iso.date().optional() });

export type SaveGoalBody = z.infer<typeof saveGoalSchema>;
