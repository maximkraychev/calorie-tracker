import { and, desc, eq, lte } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { goals } from '../../db/schema.js';
import type { SaveGoalBody } from './goals.schema.js';

// The goal read model (ARCHITECTURE.md §4.4 `DailyGoal`). Targets are effective-dated:
// a row says "from this date onward, these are the targets", and the goal for any given
// day is the latest row on or before it. `effectiveDate` travels with the goal so the
// client can tell which day's targets it is holding.
//
// `numeric` columns come back from postgres.js as strings, so they are parsed here the
// way diary.service.ts parses its own.
export interface DailyGoal {
  effectiveDate: string;
  kcalTarget: number;
  proteinTargetG: number | null;
  carbsTargetG: number | null;
  fatTargetG: number | null;
}

type GoalRow = typeof goals.$inferSelect;

function toNumber(value: string | null): number | null {
  return value === null ? null : Number.parseFloat(value);
}

// numeric columns want strings on the way in; null stays null (target not tracked).
function num(value: number | null | undefined): string | null {
  return value == null ? null : String(value);
}

function toDailyGoal(row: GoalRow): DailyGoal {
  return {
    effectiveDate: row.effectiveDate,
    kcalTarget: row.kcalTarget,
    proteinTargetG: toNumber(row.proteinTargetG),
    carbsTargetG: toNumber(row.carbsTargetG),
    fatTargetG: toNumber(row.fatTargetG),
  };
}

// The goal in force on `date`: the user's most recent row with effective_date <= date.
// This is the read half of the effective-dating — changing your targets today leaves
// every past day judged by the goal you actually held then.
//
// Null when the user has never set a goal (or set their first one after `date`); the
// client falls back to its defaults rather than the server inventing targets.
//
// Also used by the diary module to fill each day's `goal`, so the math behind "which
// goal applied on this day" lives here only.
export async function getGoalForDate(userId: string, date: string): Promise<DailyGoal | null> {
  const [row] = await db
    .select()
    .from(goals)
    .where(and(eq(goals.userId, userId), lte(goals.effectiveDate, date)))
    .orderBy(desc(goals.effectiveDate))
    .limit(1);

  return row ? toDailyGoal(row) : null;
}

// PUT /api/goals — upsert the row for `effectiveDate`, defaulting to today.
//
// Upsert rather than insert because the unique index on (user_id, effective_date) makes
// one row per day the rule: nudging your goal three times in an afternoon rewrites
// today's row instead of piling up history that all carries the same date.
export async function saveGoal(
  userId: string,
  body: SaveGoalBody,
  fallbackDate: string,
): Promise<DailyGoal> {
  const targets = {
    kcalTarget: body.kcalTarget,
    proteinTargetG: num(body.proteinTargetG),
    carbsTargetG: num(body.carbsTargetG),
    fatTargetG: num(body.fatTargetG),
  };

  const [row] = await db
    .insert(goals)
    .values({ userId, effectiveDate: body.effectiveDate ?? fallbackDate, ...targets })
    .onConflictDoUpdate({ target: [goals.userId, goals.effectiveDate], set: targets })
    .returning();

  // Non-null: an upsert always returns its row.
  return toDailyGoal(row!);
}
