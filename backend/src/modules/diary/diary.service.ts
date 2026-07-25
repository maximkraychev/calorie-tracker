import { and, asc, eq } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { logEntries } from '../../db/schema.js';
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
  goal: null; // goals module not built yet — the UI reads targets from localStorage
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
  const rows = await db
    .select()
    .from(logEntries)
    .where(and(eq(logEntries.userId, userId), eq(logEntries.entryDate, date)))
    .orderBy(asc(logEntries.createdAt));

  const entries = rows.map(toDiaryEntry);
  return { date, goal: null, totals: sumTotals(entries), entries };
}

// POST /api/diary/entries — insert one row per item, all under the same date + meal.
export async function addEntries(
  userId: string,
  body: CreateEntriesBody,
): Promise<DiaryEntry[]> {
  const values = body.items.map((item) => ({
    userId,
    entryDate: body.date,
    meal: body.meal,
    name: item.name,
    brand: item.brand?.trim() || null,
    source: item.source,
    grams: num(item.grams),
    kcalPer100g: num(item.per100g.kcal),
    proteinPer100g: num(item.per100g.protein),
    carbsPer100g: num(item.per100g.carbs),
    fatPer100g: num(item.per100g.fat),
    servingSizeG: item.servingSizeG != null ? num(item.servingSizeG) : null,
    externalId: item.externalId?.trim() || null,
  }));

  const rows = await db.insert(logEntries).values(values).returning();
  return rows.map(toDiaryEntry);
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
