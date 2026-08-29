import { and, asc, eq, inArray } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { customFoods, logEntries } from '../../db/schema.js';
import { getGoalForDate, type DailyGoal } from '../goals/goals.service.js';
import { loadRecipeSnapshots, type RecipeSnapshot } from '../recipes/recipes.service.js';
import { AppError } from '../../utils/app-error.js';
import type { CreateEntriesBody, UpdateEntryBody } from './diary.schema.js';

// The diary read model (ARCHITECTURE.md §4.4). Nutrition numbers are plain JSON numbers:
// postgres.js returns `numeric` columns as strings, so `toDiaryEntry` parseFloat-s them.
interface Per100g {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface DiaryEntry {
  id: string;
  date: string;
  meal: string;
  name: string;
  brand: string | null;
  source: string;
  grams: number;
  per100g: Per100g;
  servingSizeG: number | null;
  servings: number | null; // derived: grams / servingSizeG
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  customFoodId: string | null;
  recipeId: string | null;
  externalId: string | null;
}

export interface DiaryDay {
  date: string;
  // The targets in force on `date` — the latest goal row effective on or before it, so
  // a past day is judged by the goal held then, not today's. Null until the user sets
  // their first goal; the client falls back to its defaults.
  goal: DailyGoal | null;
  totals: Per100g;
  entries: DiaryEntry[];
}

type LogEntryRow = typeof logEntries.$inferSelect;

// A numeric(x,2) column round-trips as a string. Insert wants strings too, so serialize
// on the way in and parse on the way out.
function num(value: string | number): string {
  return String(value);
}

function toNumber(value: string | null): number | null {
  return value === null ? null : Number.parseFloat(value);
}

function toDiaryEntry(row: LogEntryRow): DiaryEntry {
  const grams = Number.parseFloat(row.grams);
  const servingSizeG = toNumber(row.servingSizeG);
  return {
    id: row.id,
    date: row.entryDate,
    meal: row.meal,
    name: row.name,
    brand: row.brand,
    source: row.source,
    grams,
    per100g: {
      kcal: Number.parseFloat(row.kcalPer100g),
      protein: Number.parseFloat(row.proteinPer100g),
      carbs: Number.parseFloat(row.carbsPer100g),
      fat: Number.parseFloat(row.fatPer100g),
    },
    servingSizeG,
    servings: servingSizeG ? Math.round((grams / servingSizeG) * 100) / 100 : null,
    // Generated columns are non-nullable in practice (grams + per100g are NOT NULL).
    kcal: toNumber(row.kcal) ?? 0,
    proteinG: toNumber(row.proteinG) ?? 0,
    carbsG: toNumber(row.carbsG) ?? 0,
    fatG: toNumber(row.fatG) ?? 0,
    customFoodId: row.customFoodId,
    recipeId: row.recipeId,
    externalId: row.externalId,
  };
}

function sumTotals(entries: DiaryEntry[]): Per100g {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return entries.reduce(
    (total, entry) => ({
      kcal: round2(total.kcal + entry.kcal),
      protein: round2(total.protein + entry.proteinG),
      carbs: round2(total.carbs + entry.carbsG),
      fat: round2(total.fat + entry.fatG),
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

// GET /api/diary?date= — the whole day for the diary screen.
export async function getDiary(userId: string, date: string): Promise<DiaryDay> {
  // Independent queries — the goal doesn't depend on the entries, so pay for one round
  // trip rather than two.
  const [rows, goal] = await Promise.all([
    db
      .select()
      .from(logEntries)
      .where(and(eq(logEntries.userId, userId), eq(logEntries.entryDate, date)))
      .orderBy(asc(logEntries.createdAt)),
    getGoalForDate(userId, date),
  ]);

  const entries = rows.map(toDiaryEntry);
  return { date, goal, totals: sumTotals(entries), entries };
}

// POST /api/diary/entries — insert one row per item, all under the same date + meal.
//
// Items with `source: 'custom'` or `'recipe'` carry only an id and a portion; their
// nutrition is read out of custom_foods / derived from the recipe here rather than taken
// from the request (ARCHITECTURE.md §4.4). Both resolutions happen up front, before
// anything is written, so a batch naming a food or recipe the user doesn't own fails
// whole rather than inserting its other items.
export async function addEntries(userId: string, body: CreateEntriesBody): Promise<DiaryEntry[]> {
  const customFoodsById = await loadCustomFoods(userId, body.items);
  const recipesById = await loadRecipes(userId, body.items);

  const values: (typeof logEntries.$inferInsert)[] = body.items.map((item) => {
    const common = { userId, entryDate: body.date, meal: body.meal, grams: num(item.grams) };

    if (item.source === 'recipe') {
      // Non-null: loadRecipes threw if any id was missing.
      const recipe = recipesById.get(item.recipeId)!;
      return {
        ...common,
        source: 'recipe' as const,
        name: recipe.name,
        // A recipe has no brand — it is the user's own dish, and `source` already says so.
        brand: null,
        kcalPer100g: num(recipe.per100g.kcal),
        proteinPer100g: num(recipe.per100g.protein),
        carbsPer100g: num(recipe.per100g.carbs),
        fatPer100g: num(recipe.per100g.fat),
        // The whole dish is the natural serving, so the entry's derived `servings` reads
        // as a fraction of the recipe — "0.25" for a quarter of the tray.
        servingSizeG: num(recipe.totalWeightG),
        customFoodId: null,
        recipeId: recipe.id,
        externalId: null,
      };
    }

    if (item.source === 'custom') {
      // Non-null: loadCustomFoods threw if any id was missing.
      const food = customFoodsById.get(item.customFoodId)!;
      return {
        ...common,
        source: 'custom' as const,
        name: food.name,
        brand: food.brand,
        // Already strings on the way out of postgres.js, and strings is what the insert
        // wants — a parse-and-restringify round trip would only invite precision loss.
        kcalPer100g: food.kcalPer100g,
        proteinPer100g: food.proteinPer100g,
        carbsPer100g: food.carbsPer100g,
        fatPer100g: food.fatPer100g,
        servingSizeG: food.servingSizeG,
        customFoodId: food.id,
        externalId: null,
      };
    }

    return {
      ...common,
      source: item.source,
      name: item.name,
      brand: item.brand?.trim() || null,
      kcalPer100g: num(item.per100g.kcal),
      proteinPer100g: num(item.per100g.protein),
      carbsPer100g: num(item.per100g.carbs),
      fatPer100g: num(item.per100g.fat),
      servingSizeG: item.servingSizeG != null ? num(item.servingSizeG) : null,
      customFoodId: null,
      externalId: item.externalId?.trim() || null,
    };
  });

  const rows = await db.insert(logEntries).values(values).returning();
  return rows.map(toDiaryEntry);
}

// The custom foods a batch refers to, keyed by id — one query regardless of batch size.
//
// The lookup is scoped to the user, so a food belonging to someone else simply isn't in
// the result and is indistinguishable from one that never existed: both are the same 404,
// which is what keeps the endpoint from confirming that an id exists for another account.
async function loadCustomFoods(
  userId: string,
  items: CreateEntriesBody['items'],
): Promise<Map<string, typeof customFoods.$inferSelect>> {
  const ids = [
    ...new Set(items.filter((item) => item.source === 'custom').map((item) => item.customFoodId)),
  ];
  if (ids.length === 0) return new Map();

  const rows = await db
    .select()
    .from(customFoods)
    .where(and(eq(customFoods.userId, userId), inArray(customFoods.id, ids)));

  if (rows.length !== ids.length) throw new AppError('Food not found', 404);
  return new Map(rows.map((row) => [row.id, row]));
}

// The recipes a batch refers to, resolved to name + weight + derived per-100g values. The
// math is the recipes module's (`computeRecipeNutrition`), not duplicated here: a logged
// recipe has to scale exactly the way the Recipes tab said it would.
async function loadRecipes(
  userId: string,
  items: CreateEntriesBody['items'],
): Promise<Map<string, RecipeSnapshot>> {
  const ids = [
    ...new Set(items.filter((item) => item.source === 'recipe').map((item) => item.recipeId)),
  ];
  return loadRecipeSnapshots(userId, ids);
}

// PATCH /api/diary/entries/:id — move to a different grams/meal/date. Scoped to the
// owner; a row that isn't theirs is a 404 (never 403, to avoid leaking existence).
export async function updateEntry(
  userId: string,
  id: string,
  patch: UpdateEntryBody,
): Promise<DiaryEntry> {
  const set: Partial<typeof logEntries.$inferInsert> = {};
  if (patch.grams !== undefined) set.grams = num(patch.grams);
  if (patch.meal !== undefined) set.meal = patch.meal;
  if (patch.date !== undefined) set.entryDate = patch.date;

  const [row] = await db
    .update(logEntries)
    .set(set)
    .where(and(eq(logEntries.id, id), eq(logEntries.userId, userId)))
    .returning();

  if (!row) throw new AppError('Entry not found', 404);
  return toDiaryEntry(row);
}

// DELETE /api/diary/entries/:id — same ownership scoping.
export async function deleteEntry(userId: string, id: string): Promise<void> {
  const deleted = await db
    .delete(logEntries)
    .where(and(eq(logEntries.id, id), eq(logEntries.userId, userId)))
    .returning({ id: logEntries.id });

  if (deleted.length === 0) throw new AppError('Entry not found', 404);
}
