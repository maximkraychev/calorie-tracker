import { sumMacros, type Macros, type Per100g } from '../../../shared/utils/nutrition.utils';

// A recipe the user built themselves — a premade dish, logged by grams and scaled from
// its per-100g values exactly like any other food.
//
// Two modes, and the difference is only where the numbers come from:
//   'ingredients' — nutrition is summed from `ingredients`, each a snapshot taken when it
//                   was added. `totalWeightG` defaults to the sum of ingredient grams and
//                   can be overridden with a cooked weight (a stew loses water, and it is
//                   the cooked weight the user actually puts on a scale).
//   'manual'      — flat totals for the whole dish, with a required weight to scale by.
export type RecipeMode = 'ingredients' | 'manual';

/** Where a recipe ingredient came from. Recipes do not nest, so 'recipe' is not here. */
export type IngredientSource = 'search' | 'generic' | 'barcode' | 'custom' | 'manual';

// One ingredient. Extends the flattened `Per100g` (rather than nesting a `per100g` object
// as the wire format does) so `macrosOf({ ...ingredient })` works directly — an ingredient
// is already a `Portion`.
export interface RecipeIngredient extends Per100g {
  id: string;
  name: string;
  brand: string | null;
  source: IngredientSource;
  /** Provenance only — nulled server-side if the custom food is later deleted. */
  customFoodId: string | null;
  /** The Open Food Facts code or `usda:<fdcId>`. Provenance only. */
  externalId: string | null;
  grams: number;
}

// Same flattening choice as `CustomFood`: it makes a recipe interchangeable with a search
// hit in the Add-Food overlay, so logging one needs no adapter.
export interface Recipe extends Per100g {
  id: string;
  name: string;
  mode: RecipeMode;
  /** Always resolved by the server, even when the column behind it is null. */
  totalWeightG: number;
  /** The whole dish, not per 100 g — what the sheet shows while you build it. */
  totals: Macros;
  /** Detail responses only, and only in `ingredients` mode. */
  ingredients?: RecipeIngredient[];
}

/**
 * What a create or edit submits.
 *
 * Discriminated on `mode`, mirroring the API — and note the ingredient shape drops `id`:
 * ingredients are replaced wholesale on every save, so the rows the server returns are
 * new ones and their old ids are meaningless.
 */
export type NewRecipeIngredient = Omit<RecipeIngredient, 'id'>;

export type NewRecipe =
  | {
      name: string;
      mode: 'ingredients';
      /** Null means "use the sum of ingredient grams". */
      totalWeightG: number | null;
      ingredients: NewRecipeIngredient[];
    }
  | {
      name: string;
      mode: 'manual';
      totalWeightG: number;
      totals: Macros;
    };

/**
 * The weight, whole-dish totals and per-100g values a submitted recipe works out to.
 *
 * This is the server's `computeRecipeNutrition` mirrored on the client, and it exists for
 * two callers: the sheet, which previews the numbers live while the user builds the
 * ingredient list, and the store, which needs them to render an optimistic row before the
 * server answers. Both are then reconciled with the server's own figures, which stay
 * authoritative — this is a preview, not a second source of truth.
 */
export function deriveNutrition(input: NewRecipe): {
  totalWeightG: number;
  totals: Macros;
  per100g: Per100g;
} {
  const totals = input.mode === 'manual' ? input.totals : sumMacros(input.ingredients);

  const totalWeightG =
    input.mode === 'manual'
      ? input.totalWeightG
      : (input.totalWeightG ??
        input.ingredients.reduce((sum, ingredient) => sum + ingredient.grams, 0));

  // Guarded because an in-progress recipe legitimately has no ingredients yet, and the
  // sheet previews it on every keystroke.
  const scale = totalWeightG > 0 ? 100 / totalWeightG : 0;

  return {
    totalWeightG,
    totals,
    per100g: {
      kcalPer100g: totals.kcal * scale,
      proteinPer100g: totals.protein * scale,
      carbsPer100g: totals.carbs * scale,
      fatPer100g: totals.fat * scale,
    },
  };
}

/** Client-side filter over the loaded list — the same job `filterFoods` does for foods. */
export function filterRecipes(recipes: readonly Recipe[], query: string): Recipe[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...recipes];
  return recipes.filter((recipe) => recipe.name.toLowerCase().includes(needle));
}
