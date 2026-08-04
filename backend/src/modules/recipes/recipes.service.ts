import { and, asc, eq, ilike, inArray } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { customFoods, recipeIngredients, recipes } from '../../db/schema.js';
import { AppError } from '../../utils/app-error.js';
import type { RecipeBody, RecipeIngredientInput } from './recipes.schema.js';

// ---------------------------------------------------------------------------
// Recipes (ARCHITECTURE.md §4.3) — CRUD over the user's own dishes.
//
// Everything here is scoped to `userId`: a row that isn't theirs is a 404, never a 403,
// so the API never confirms that an id exists for somebody else. `recipe_ingredients` has
// no `user_id` of its own — ownership runs through the parent recipe, so every read and
// write reaches the child rows via a recipe already proven to belong to the caller.
// ---------------------------------------------------------------------------

interface Per100g {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

/**
 * One ingredient of an `ingredients`-mode recipe.
 *
 * The per-100g values are a snapshot taken when the ingredient was added, exactly like a
 * diary entry: `customFoodId` / `externalId` are provenance only, and editing (or
 * deleting) the custom food behind an ingredient never silently rewrites the recipe.
 */
export interface RecipeIngredientItem {
  id: string;
  name: string;
  brand: string | null;
  source: string;
  customFoodId: string | null;
  externalId: string | null;
  grams: number;
  per100g: Per100g;
}

/**
 * A recipe as the API returns it.
 *
 * `source` is a constant rather than dead weight — the same trick `CustomFoodItem` plays.
 * It makes the shape assignable to the frontend's food shape, so a recipe drops into the
 * Add-Food list and portion step with no adapter in between.
 *
 * `per100g` is the derived number that matters: logging a recipe snapshots it and scales
 * by grams, which is why `totalWeightG` is always resolved to a real number here even
 * though the column is nullable.
 */
export interface RecipeItem {
  id: string;
  source: 'recipe';
  name: string;
  mode: 'ingredients' | 'manual';
  totalWeightG: number;
  per100g: Per100g;
  totals: Per100g;
  /** Detail responses only, and only for `ingredients` mode. */
  ingredients?: RecipeIngredientItem[];
}

type RecipeRow = typeof recipes.$inferSelect;
type IngredientRow = typeof recipeIngredients.$inferSelect;

/** The ingredient columns a create or replace writes — `recipeId`/`position` added later. */
type IngredientValues = Omit<typeof recipeIngredients.$inferInsert, 'recipeId' | 'position'>;

/** Just enough of a recipe row (or of the columns about to become one) to do the math. */
type NutritionShape = Pick<
  RecipeRow,
  'nutritionMode' | 'totalWeightG' | 'kcalTotal' | 'proteinTotalG' | 'carbsTotalG' | 'fatTotalG'
>;

/** Just enough of an ingredient row (or of pending insert values) to do the math. */
type IngredientShape = Pick<
  IngredientRow,
  'grams' | 'kcalPer100g' | 'proteinPer100g' | 'carbsPer100g' | 'fatPer100g'
>;

/** postgres.js returns `numeric` as a string to avoid float64 precision loss. */
function toNumber(value: string | null): number {
  const parsed = value === null ? Number.NaN : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Insert wants `numeric` as a string, same as it reads back as one. */
function num(value: number): string {
  return String(value);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// Nutrition math
// ---------------------------------------------------------------------------

/**
 * Resolve a recipe's weight, whole-dish totals and derived per-100g values.
 *
 * Two modes, one output shape:
 *   'manual'      — totals and weight are stored columns; per100g is derived from them.
 *   'ingredients' — totals are summed from the ingredient snapshots, and the weight is
 *                   the stored override if there is one, else the sum of ingredient grams.
 *                   The override exists for cooked weight: a stew loses water, so 1200 g
 *                   of ingredients can portion out as 900 g of food, and it is the cooked
 *                   weight the user actually puts on a scale.
 *
 * Exported because the diary resolves a logged recipe's snapshot through it — the math
 * has exactly one home.
 */
export function computeRecipeNutrition(
  recipe: NutritionShape,
  ingredients: readonly IngredientShape[],
): { totalWeightG: number; totals: Per100g; per100g: Per100g } {
  const totals =
    recipe.nutritionMode === 'manual'
      ? {
          kcal: toNumber(recipe.kcalTotal),
          protein: toNumber(recipe.proteinTotalG),
          carbs: toNumber(recipe.carbsTotalG),
          fat: toNumber(recipe.fatTotalG),
        }
      : sumIngredients(ingredients);

  const explicitWeight = recipe.totalWeightG === null ? null : toNumber(recipe.totalWeightG);
  const totalWeightG =
    explicitWeight ??
    round2(ingredients.reduce((sum, ingredient) => sum + toNumber(ingredient.grams), 0));

  // Unreachable through the API (manual mode requires a positive weight, and an
  // ingredients recipe needs at least one row with grams > 0), but dividing by it would
  // produce Infinity and a 500 three layers away, so it is worth the two lines.
  const scale = totalWeightG > 0 ? 100 / totalWeightG : 0;

  return {
    totalWeightG,
    totals: {
      kcal: round2(totals.kcal),
      protein: round2(totals.protein),
      carbs: round2(totals.carbs),
      fat: round2(totals.fat),
    },
    per100g: {
      kcal: round2(totals.kcal * scale),
      protein: round2(totals.protein * scale),
      carbs: round2(totals.carbs * scale),
      fat: round2(totals.fat * scale),
    },
  };
}

function sumIngredients(ingredients: readonly IngredientShape[]): Per100g {
  return ingredients.reduce(
    (total, ingredient) => {
      // Each ingredient's contribution is its per-100g values scaled by its own portion.
      const portion = toNumber(ingredient.grams) / 100;
      return {
        kcal: total.kcal + toNumber(ingredient.kcalPer100g) * portion,
        protein: total.protein + toNumber(ingredient.proteinPer100g) * portion,
        carbs: total.carbs + toNumber(ingredient.carbsPer100g) * portion,
        fat: total.fat + toNumber(ingredient.fatPer100g) * portion,
      };
    },
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

/**
 * Reject a recipe whose derived per-100g values could never be stored on a diary entry.
 *
 * `log_entries` carries the same `per100gChecks` as every other nutrition table (kcal ≤
 * 900, each macro ≤ 100), so a recipe of 5000 kcal per 100 g would save happily and then
 * fail at log time as an opaque 500. Catching it here turns it into a 400 against the
 * field the user actually got wrong — almost always a total weight that is too small for
 * the totals entered.
 */
function assertLoggable(per100g: Per100g): void {
  const withinRange =
    per100g.kcal <= 900 && per100g.protein <= 100 && per100g.carbs <= 100 && per100g.fat <= 100;

  if (!withinRange) {
    throw new AppError('Recipe nutrition is out of range for its total weight', 400);
  }
}

// ---------------------------------------------------------------------------
// Row → DTO
// ---------------------------------------------------------------------------

function toIngredientItem(row: IngredientRow): RecipeIngredientItem {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    source: row.source,
    customFoodId: row.customFoodId,
    externalId: row.externalId,
    grams: toNumber(row.grams),
    per100g: {
      kcal: toNumber(row.kcalPer100g),
      protein: toNumber(row.proteinPer100g),
      carbs: toNumber(row.carbsPer100g),
      fat: toNumber(row.fatPer100g),
    },
  };
}

// `includeIngredients` is what separates a list response from a detail one: the list
// still needs the ingredient rows (it sums them for the totals) but does not ship them.
function toRecipeItem(
  row: RecipeRow,
  ingredients: readonly IngredientRow[],
  includeIngredients: boolean,
): RecipeItem {
  const { totalWeightG, totals, per100g } = computeRecipeNutrition(row, ingredients);

  const item: RecipeItem = {
    id: row.id,
    source: 'recipe',
    name: row.name,
    mode: row.nutritionMode,
    totalWeightG,
    per100g,
    totals,
  };

  if (includeIngredients && row.nutritionMode === 'ingredients') {
    item.ingredients = ingredients.map(toIngredientItem);
  }
  return item;
}

// ---------------------------------------------------------------------------
// Body → columns
// ---------------------------------------------------------------------------

/**
 * The `recipes` columns a create or a full-replace update writes.
 *
 * Which columns are NULL is not cosmetic: `recipes_mode_shape` requires an 'ingredients'
 * recipe to have all four totals NULL and a 'manual' one to have all four set alongside a
 * weight. Writing every column on every mode is what makes switching mode on a PUT work.
 */
function toRecipeColumns(body: RecipeBody) {
  if (body.mode === 'manual') {
    return {
      name: body.name,
      nutritionMode: 'manual' as const,
      totalWeightG: num(body.totalWeightG),
      kcalTotal: num(body.totals.kcal),
      proteinTotalG: num(body.totals.protein),
      carbsTotalG: num(body.totals.carbs),
      fatTotalG: num(body.totals.fat),
    };
  }

  return {
    name: body.name,
    nutritionMode: 'ingredients' as const,
    totalWeightG: body.totalWeightG != null ? num(body.totalWeightG) : null,
    kcalTotal: null,
    proteinTotalG: null,
    carbsTotalG: null,
    fatTotalG: null,
  };
}

/**
 * Turn submitted ingredients into insertable rows, resolving the custom ones.
 *
 * `source: 'custom'` ingredients arrive as an id and a portion; their name, brand and
 * nutrition are read out of `custom_foods` here rather than taken from the request. The
 * lookup is scoped to the user, so a food belonging to someone else simply isn't in the
 * result and is indistinguishable from one that never existed — both are the same 404.
 *
 * One query regardless of ingredient count, and it runs before the transaction opens: a
 * recipe naming a food the user doesn't own fails whole rather than half-writing.
 */
async function resolveIngredients(
  userId: string,
  inputs: readonly RecipeIngredientInput[],
): Promise<IngredientValues[]> {
  const ids = [
    ...new Set(
      inputs.filter((input) => input.source === 'custom').map((input) => input.customFoodId),
    ),
  ];

  const foodsById = new Map<string, typeof customFoods.$inferSelect>();
  if (ids.length > 0) {
    const rows = await db
      .select()
      .from(customFoods)
      .where(and(eq(customFoods.userId, userId), inArray(customFoods.id, ids)));

    if (rows.length !== ids.length) throw new AppError('Food not found', 404);
    for (const row of rows) foodsById.set(row.id, row);
  }

  return inputs.map((input) => {
    if (input.source === 'custom') {
      // Non-null: the length check above threw if any id was missing.
      const food = foodsById.get(input.customFoodId)!;
      return {
        name: food.name,
        brand: food.brand,
        source: 'custom' as const,
        customFoodId: food.id,
        externalId: null,
        grams: num(input.grams),
        // Already strings on the way out of postgres.js, and strings is what the insert
        // wants — a parse-and-restringify round trip would only invite precision loss.
        kcalPer100g: food.kcalPer100g,
        proteinPer100g: food.proteinPer100g,
        carbsPer100g: food.carbsPer100g,
        fatPer100g: food.fatPer100g,
      };
    }

    return {
      name: input.name,
      brand: input.brand?.trim() || null,
      source: input.source,
      customFoodId: null,
      externalId: input.externalId?.trim() || null,
      grams: num(input.grams),
      kcalPer100g: num(input.per100g.kcal),
      proteinPer100g: num(input.per100g.protein),
      carbsPer100g: num(input.per100g.carbs),
      fatPer100g: num(input.per100g.fat),
    };
  });
}

/** Shared by create and update: resolve ingredients, build columns, reject the unloggable. */
async function prepare(
  userId: string,
  body: RecipeBody,
): Promise<{ columns: ReturnType<typeof toRecipeColumns>; ingredients: IngredientValues[] }> {
  const ingredients =
    body.mode === 'ingredients' ? await resolveIngredients(userId, body.ingredients) : [];
  const columns = toRecipeColumns(body);

  assertLoggable(computeRecipeNutrition(columns, ingredients).per100g);

  return { columns, ingredients };
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

// GET /api/recipes?q= — the whole list, or the rows whose name matches. Alphabetical
// because the list is browsed, not ranked; `recipes_name_trgm_idx` serves the ILIKE.
//
// Ingredient rows are still fetched (the totals are summed from them) but not returned.
// One extra query for the whole page rather than one per recipe, and only for the
// recipes that can have rows at all.
export async function listRecipes(userId: string, q?: string): Promise<RecipeItem[]> {
  const rows = await db
    .select()
    .from(recipes)
    .where(
      q === undefined
        ? eq(recipes.userId, userId)
        : and(eq(recipes.userId, userId), ilike(recipes.name, `%${q}%`)),
    )
    .orderBy(asc(recipes.name));

  const computedIds = rows.filter((row) => row.nutritionMode === 'ingredients').map((r) => r.id);
  const byRecipe = new Map<string, IngredientRow[]>();

  if (computedIds.length > 0) {
    const ingredientRows = await db
      .select()
      .from(recipeIngredients)
      .where(inArray(recipeIngredients.recipeId, computedIds))
      .orderBy(asc(recipeIngredients.position));

    for (const row of ingredientRows) {
      const list = byRecipe.get(row.recipeId);
      if (list) list.push(row);
      else byRecipe.set(row.recipeId, [row]);
    }
  }

  return rows.map((row) => toRecipeItem(row, byRecipe.get(row.id) ?? [], false));
}

// GET /api/recipes/:id — the detail response, ingredients included.
export async function getRecipe(userId: string, id: string): Promise<RecipeItem> {
  const [row] = await db
    .select()
    .from(recipes)
    .where(and(eq(recipes.id, id), eq(recipes.userId, userId)))
    .limit(1);

  if (!row) throw new AppError('Recipe not found', 404);

  const ingredients = await loadIngredients(row);
  return toRecipeItem(row, ingredients, true);
}

async function loadIngredients(row: RecipeRow): Promise<IngredientRow[]> {
  if (row.nutritionMode !== 'ingredients') return [];
  return db
    .select()
    .from(recipeIngredients)
    .where(eq(recipeIngredients.recipeId, row.id))
    .orderBy(asc(recipeIngredients.position));
}

// POST /api/recipes — the recipe and its ingredients are one unit, so they are written in
// one transaction: a failed ingredient insert must not leave a recipe with no rows, which
// `recipes_mode_shape` cannot catch (a CHECK can't see another table).
export async function createRecipe(userId: string, body: RecipeBody): Promise<RecipeItem> {
  const { columns, ingredients } = await prepare(userId, body);

  const { recipe, rows } = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(recipes)
      .values({ userId, ...columns })
      .returning();

    const inserted =
      ingredients.length > 0
        ? await tx
            .insert(recipeIngredients)
            .values(
              // `position` is the submitted order — the list is the user's, and it reads
              // as a recipe, so it has to come back the way they wrote it.
              ingredients.map((values, index) => ({
                ...values,
                recipeId: created!.id,
                position: index,
              })),
            )
            .returning()
        : [];

    return { recipe: created!, rows: inserted };
  });

  return toRecipeItem(recipe, rows, true);
}

// PUT /api/recipes/:id — a full replace, ingredients included: the old rows are dropped
// and the submitted list is written fresh. Editing one ingredient's grams and re-sending
// the list is therefore the same operation as reordering or replacing all of them.
//
// `updated_at` is left alone; the recipes_set_updated_at trigger (migration 0001) owns it.
export async function updateRecipe(
  userId: string,
  id: string,
  body: RecipeBody,
): Promise<RecipeItem> {
  const { columns, ingredients } = await prepare(userId, body);

  const { recipe, rows } = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(recipes)
      .set(columns)
      .where(and(eq(recipes.id, id), eq(recipes.userId, userId)))
      .returning();

    // Ownership is proven by the UPDATE matching nothing; throwing rolls the tx back
    // before any ingredient row is touched.
    if (!updated) throw new AppError('Recipe not found', 404);

    await tx.delete(recipeIngredients).where(eq(recipeIngredients.recipeId, id));

    const inserted =
      ingredients.length > 0
        ? await tx
            .insert(recipeIngredients)
            .values(
              ingredients.map((values, index) => ({ ...values, recipeId: id, position: index })),
            )
            .returning()
        : [];

    return { recipe: updated, rows: inserted };
  });

  return toRecipeItem(recipe, rows, true);
}

// DELETE /api/recipes/:id — ingredients cascade. Diary entries survive: they carry their
// own nutrition snapshot and `log_entries.recipe_id` is ON DELETE SET NULL, so only the
// provenance link goes.
export async function deleteRecipe(userId: string, id: string): Promise<void> {
  const deleted = await db
    .delete(recipes)
    .where(and(eq(recipes.id, id), eq(recipes.userId, userId)))
    .returning({ id: recipes.id });

  if (deleted.length === 0) throw new AppError('Recipe not found', 404);
}

// ---------------------------------------------------------------------------
// Diary support
// ---------------------------------------------------------------------------

/** What the diary needs to snapshot a logged recipe — name plus the derived numbers. */
export interface RecipeSnapshot {
  id: string;
  name: string;
  totalWeightG: number;
  per100g: Per100g;
}

/**
 * The snapshots for a set of recipe ids, keyed by id — two queries regardless of how many.
 *
 * Scoped to the user for the same reason `loadCustomFoods` is: a recipe belonging to
 * someone else is absent from the result and reads as a 404, so the diary never confirms
 * that an id exists for another account.
 */
export async function loadRecipeSnapshots(
  userId: string,
  ids: readonly string[],
): Promise<Map<string, RecipeSnapshot>> {
  if (ids.length === 0) return new Map();

  const rows = await db
    .select()
    .from(recipes)
    .where(and(eq(recipes.userId, userId), inArray(recipes.id, [...ids])));

  if (rows.length !== ids.length) throw new AppError('Recipe not found', 404);

  const computedIds = rows.filter((row) => row.nutritionMode === 'ingredients').map((r) => r.id);
  const byRecipe = new Map<string, IngredientShape[]>();

  if (computedIds.length > 0) {
    const ingredientRows = await db
      .select({
        recipeId: recipeIngredients.recipeId,
        grams: recipeIngredients.grams,
        kcalPer100g: recipeIngredients.kcalPer100g,
        proteinPer100g: recipeIngredients.proteinPer100g,
        carbsPer100g: recipeIngredients.carbsPer100g,
        fatPer100g: recipeIngredients.fatPer100g,
      })
      .from(recipeIngredients)
      .where(inArray(recipeIngredients.recipeId, computedIds));

    for (const row of ingredientRows) {
      const list = byRecipe.get(row.recipeId);
      if (list) list.push(row);
      else byRecipe.set(row.recipeId, [row]);
    }
  }

  return new Map(
    rows.map((row) => {
      const { totalWeightG, per100g } = computeRecipeNutrition(row, byRecipe.get(row.id) ?? []);
      return [row.id, { id: row.id, name: row.name, totalWeightG, per100g }];
    }),
  );
}
