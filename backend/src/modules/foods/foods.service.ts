import { and, asc, desc, eq, ilike, sql } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { customFoods, genericFoods, type GenericFoodPortion } from '../../db/schema.js';
import { tokenizeQuery } from '../../services/fdc-text.js';
import { rankFoods } from '../../services/food-search.js';
import { AppError } from '../../utils/app-error.js';
import type { CustomFoodBody } from './foods.schema.js';

interface Per100g {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

/**
 * One search hit from the generic (whole-food) catalog.
 *
 * `kind` distinguishes it from other catalogs should they ever share this endpoint.
 * Custom foods deliberately do NOT come back from here: they are a small, personal list
 * the user browses, not a corpus to rank, and mixing them into the text-search ordering
 * would mean tuning one relevance function against two very different data sets. They
 * are served whole by `GET /api/foods` and filtered client-side.
 *
 * Everything below is deliberately shaped like the frontend's existing `FoodItem`
 * (ARCHITECTURE.md §6) — `brand` is always null for a generic food, but it stays in the
 * shape so an Open Food Facts result and a USDA result are interchangeable in the UI
 * without a mapping layer.
 */
export interface FoodSearchItem {
  kind: 'generic';
  id: string;
  /** Maps onto the `food_source` enum when the user logs this. */
  source: 'generic';
  /** The USDA fdcId. Provenance only, and what distinguishes it from an OFF barcode. */
  externalId: string | null;
  name: string;
  /**
   * Bulgarian display name, or null while the translation file is still filling up.
   * BOTH names are returned and the client picks by locale — resolving it server-side
   * would need the request to carry a language, and the same response is cacheable.
   */
  nameBg: string | null;
  brand: string | null;
  category: string | null;
  per100g: Per100g;
  servingSizeG: number | null;
  /** Household measures, e.g. `1 medium (7" to 7-7/8" long)` → 118 g. */
  portions: GenericFoodPortion[];
}

/**
 * How many rows to pull out of Postgres before ranking in memory.
 *
 * SQL does the filtering (indexed, cheap); the ordering that matters is applied here in
 * JS by `rankFoods`, because it is the same code the importer's report is validated
 * against. A query like "chicken" matches many hundreds of cuts, so the pool is ordered
 * by the row's own specificity boost first — that way truncating it drops the obscure
 * variants rather than the plain entry.
 */
const CANDIDATE_POOL = 200;

/** postgres.js returns `numeric` as a string to avoid float64 precision loss. */
function toNumber(value: string | null): number {
  const parsed = value === null ? Number.NaN : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Search the generic (whole-food) catalog.
 *
 * Every query token must match `search_text` at a word boundary — all tokens, not any,
 * so "chicken breast" cannot be satisfied by a row that only mentions chicken.
 *
 * Two predicates per token on purpose:
 *   ILIKE '%token%'  — plain containment, which the GIN trigram index accelerates.
 *   ~ '\mtoken'      — Postgres's start-of-word anchor, which enforces the precision.
 * The regex alone would be correct but leans on the planner to use the index for it; the
 * ILIKE guarantees the index does the narrowing and the regex only re-checks survivors.
 * Prefix, not whole-word, because "tomato" has to reach "tomatoes" and "банан" "банани";
 * `rankFoods` then demotes the prefix-only hits so "egg" does not surface Eggplant.
 */
export async function searchFoods(query: string, limit: number): Promise<FoodSearchItem[]> {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return [];

  const conditions = tokens.map((token) => {
    // The token reaches Postgres as a bound parameter, but it is concatenated into a
    // regex there, so escape the metacharacters. Tokens are already stripped of
    // punctuation by `tokenizeQuery`; this is defence in depth, not the only guard.
    const escaped = token.replace(/[\\^$.|?*+()[\]{}]/g, '\\$&');
    return and(
      sql`${genericFoods.searchText} ILIKE ${`%${token}%`}`,
      sql`${genericFoods.searchText} ~ ${`\\m${escaped}`}`,
    );
  });

  const rows = await db
    .select({
      id: genericFoods.id,
      externalId: genericFoods.externalId,
      name: genericFoods.name,
      nameBg: genericFoods.nameBg,
      searchText: genericFoods.searchText,
      category: genericFoods.category,
      kcal: genericFoods.kcalPer100g,
      protein: genericFoods.proteinPer100g,
      carbs: genericFoods.carbsPer100g,
      fat: genericFoods.fatPer100g,
      servingSizeG: genericFoods.servingSizeG,
      portions: genericFoods.portions,
      rank: genericFoods.rank,
    })
    .from(genericFoods)
    .where(and(...conditions))
    .orderBy(desc(genericFoods.rank), genericFoods.name)
    .limit(CANDIDATE_POOL);

  return rankFoods(rows, query, limit).map((row) => ({
    kind: 'generic' as const,
    id: row.id,
    source: 'generic' as const,
    externalId: row.externalId,
    name: row.name,
    nameBg: row.nameBg,
    brand: null,
    category: row.category,
    per100g: {
      kcal: toNumber(row.kcal),
      protein: toNumber(row.protein),
      carbs: toNumber(row.carbs),
      fat: toNumber(row.fat),
    },
    servingSizeG: row.servingSizeG === null ? null : toNumber(row.servingSizeG),
    portions: row.portions ?? [],
  }));
}

// ---------------------------------------------------------------------------
// Custom foods (ARCHITECTURE.md §4.2) — CRUD over the user's own catalog.
//
// This is the only persisted food table a user can write to. Everything here is scoped
// to `userId`: a row that isn't theirs is a 404, never a 403, so the API never confirms
// that an id exists for somebody else.
// ---------------------------------------------------------------------------

/**
 * A custom food as the API returns it.
 *
 * `source` and `externalId` are constants rather than dead weight: they make the shape
 * assignable to the frontend's `FoodItem`, so a custom food drops into the same list rows
 * and the same portion step as a search hit with no adapter in between.
 */
export interface CustomFoodItem {
  id: string;
  source: 'custom';
  externalId: null;
  name: string;
  brand: string | null;
  per100g: Per100g;
  servingSizeG: number | null;
}

type CustomFoodRow = typeof customFoods.$inferSelect;

/** Insert wants `numeric` as a string, same as it reads back as one. */
function num(value: number): string {
  return String(value);
}

function toCustomFoodItem(row: CustomFoodRow): CustomFoodItem {
  return {
    id: row.id,
    source: 'custom',
    externalId: null,
    name: row.name,
    brand: row.brand,
    per100g: {
      kcal: toNumber(row.kcalPer100g),
      protein: toNumber(row.proteinPer100g),
      carbs: toNumber(row.carbsPer100g),
      fat: toNumber(row.fatPer100g),
    },
    // Not `toNumber`, which floors null to 0 — a missing serving size must stay null.
    servingSizeG: row.servingSizeG === null ? null : toNumber(row.servingSizeG),
  };
}

/** The columns a create or a full-replace update writes. */
function toColumns(body: CustomFoodBody) {
  return {
    name: body.name,
    brand: body.brand?.trim() || null,
    kcalPer100g: num(body.per100g.kcal),
    proteinPer100g: num(body.per100g.protein),
    carbsPer100g: num(body.per100g.carbs),
    fatPer100g: num(body.per100g.fat),
    servingSizeG: body.servingSizeG != null ? num(body.servingSizeG) : null,
  };
}

// GET /api/foods?q= — the whole catalog, or the rows whose name matches. Alphabetical
// because the list is browsed, not ranked; `custom_foods_name_trgm_idx` serves the ILIKE.
export async function listCustomFoods(userId: string, q?: string): Promise<CustomFoodItem[]> {
  const rows = await db
    .select()
    .from(customFoods)
    .where(
      q === undefined
        ? eq(customFoods.userId, userId)
        : and(eq(customFoods.userId, userId), ilike(customFoods.name, `%${q}%`)),
    )
    .orderBy(asc(customFoods.name));

  return rows.map(toCustomFoodItem);
}

// POST /api/foods
export async function createCustomFood(
  userId: string,
  body: CustomFoodBody,
): Promise<CustomFoodItem> {
  const [row] = await db
    .insert(customFoods)
    .values({ userId, ...toColumns(body) })
    .returning();

  return toCustomFoodItem(row!);
}

// GET /api/foods/:id
export async function getCustomFood(userId: string, id: string): Promise<CustomFoodItem> {
  const [row] = await db
    .select()
    .from(customFoods)
    .where(and(eq(customFoods.id, id), eq(customFoods.userId, userId)))
    .limit(1);

  if (!row) throw new AppError('Food not found', 404);
  return toCustomFoodItem(row);
}

// PUT /api/foods/:id — a full replace, not a patch: every column is written, so dropping
// `brand` or `servingSizeG` from the body clears them. `updated_at` is left alone; the
// custom_foods_set_updated_at trigger (migration 0001) owns it.
export async function updateCustomFood(
  userId: string,
  id: string,
  body: CustomFoodBody,
): Promise<CustomFoodItem> {
  const [row] = await db
    .update(customFoods)
    .set(toColumns(body))
    .where(and(eq(customFoods.id, id), eq(customFoods.userId, userId)))
    .returning();

  if (!row) throw new AppError('Food not found', 404);
  return toCustomFoodItem(row);
}

// DELETE /api/foods/:id — diary entries survive: they carry their own nutrition snapshot
// and `log_entries.custom_food_id` is ON DELETE SET NULL, so only the provenance link goes.
export async function deleteCustomFood(userId: string, id: string): Promise<void> {
  const deleted = await db
    .delete(customFoods)
    .where(and(eq(customFoods.id, id), eq(customFoods.userId, userId)))
    .returning({ id: customFoods.id });

  if (deleted.length === 0) throw new AppError('Food not found', 404);
}
