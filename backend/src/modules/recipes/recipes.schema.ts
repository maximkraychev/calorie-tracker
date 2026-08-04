import { z } from 'zod';

// ---------------------------------------------------------------------------
// Recipes (ARCHITECTURE.md §4.3) — the user's own premade dishes.
//
// Zod ranges mirror the CHECK constraints on `recipes` / `recipe_ingredients`, so bad
// input is a 400 here rather than a constraint violation surfacing as a 500 at the INSERT.
// The ranges are deliberately re-declared rather than imported from another module: each
// module's Zod mirrors the checks on ITS OWN tables, and nothing should force two tables
// to keep agreeing.
// ---------------------------------------------------------------------------

// numeric(7,2) tops out at 99999.99, numeric(8,2) at 999999.99. Cap here so an oversized
// value is a 400 rather than a numeric-overflow 500.
const NUMERIC_7_2_MAX = 99999.99;
const NUMERIC_8_2_MAX = 999999.99;

// The `recipe_ingredients_*_range` checks — a per-100g snapshot, same shape as everywhere.
const per100gSchema = z.object({
  kcal: z.number().min(0).max(900),
  protein: z.number().min(0).max(100),
  carbs: z.number().min(0).max(100),
  fat: z.number().min(0).max(100),
});

// An ingredient from a source with no server-side record: the client sends the snapshot
// because nothing else can. `externalId` is the Open Food Facts code or USDA fdcId,
// provenance only.
//
// 'ai' is absent because the photo-estimate flow logs straight to the diary and never
// builds a recipe; 'recipe' is absent because recipes do not nest.
const externalIngredientSchema = z.object({
  source: z.enum(['search', 'generic', 'barcode', 'manual']),
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().max(200).nullish(),
  grams: z.number().positive().max(NUMERIC_7_2_MAX),
  per100g: per100gSchema,
  externalId: z.string().trim().max(64).nullish(),
});

// A custom food, where the server IS the source of truth — the same trust boundary the
// diary draws (diary.schema.ts). Only an id and a portion are accepted; Zod strips unknown
// keys, so a client that also sends name/brand/per100g has them silently discarded rather
// than trusted, and the service reads the real values out of `custom_foods`.
const customIngredientSchema = z.object({
  source: z.literal('custom'),
  customFoodId: z.uuid(),
  grams: z.number().positive().max(NUMERIC_7_2_MAX),
});

const ingredientSchema = z.discriminatedUnion('source', [
  externalIngredientSchema,
  customIngredientSchema,
]);

// POST /api/recipes and PUT /api/recipes/:id share this body — the update is a full
// replace, ingredients included, so omitting one drops it.
//
// Discriminated on `mode`, mirroring the `recipes_mode_shape` CHECK: an 'ingredients'
// recipe has rows and no stored totals; a 'manual' one has totals and a required weight
// (so logged grams have something to scale against) and no rows.
export const recipeBodySchema = z.discriminatedUnion('mode', [
  z.object({
    name: z.string().trim().min(1).max(200),
    mode: z.literal('ingredients'),
    // Optional: defaults to the sum of ingredient grams. Set it to record a cooked
    // weight, which is what the user actually portions out of.
    totalWeightG: z.number().positive().max(NUMERIC_8_2_MAX).nullish(),
    ingredients: z.array(ingredientSchema).min(1).max(100),
  }),
  z.object({
    name: z.string().trim().min(1).max(200),
    mode: z.literal('manual'),
    totalWeightG: z.number().positive().max(NUMERIC_8_2_MAX),
    totals: z.object({
      // kcal_total is numeric(8,2); the three macro totals are numeric(7,2).
      kcal: z.number().min(0).max(NUMERIC_8_2_MAX),
      protein: z.number().min(0).max(NUMERIC_7_2_MAX),
      carbs: z.number().min(0).max(NUMERIC_7_2_MAX),
      fat: z.number().min(0).max(NUMERIC_7_2_MAX),
    }),
  }),
]);

// GET /api/recipes?q= — `q` is optional; without it the whole list comes back. A user has
// tens of recipes, not thousands, so there is no pagination.
export const recipeListQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
});

export const recipeIdSchema = z.object({ id: z.uuid() });

export type RecipeBody = z.infer<typeof recipeBodySchema>;
export type RecipeIngredientInput = z.infer<typeof ingredientSchema>;
