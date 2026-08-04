import { and, desc, sql } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { genericFoods, type GenericFoodPortion } from '../../db/schema.js';
import { tokenizeQuery } from '../../services/fdc-text.js';
import { rankFoods } from '../../services/food-search.js';

interface Per100g {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

/**
 * One search hit.
 *
 * `kind` is what makes this endpoint extensible: custom foods and recipes will be
 * returned from the same call, tagged `'custom'` / `'recipe'`, so the frontend merges one
 * list instead of reconciling three. Everything below is deliberately shaped like the
 * frontend's existing `FoodItem` (ARCHITECTURE.md §6) — `brand` is always null for a
 * generic food, but it stays in the shape so an Open Food Facts result and a USDA result
 * are interchangeable in the UI without a mapping layer.
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
