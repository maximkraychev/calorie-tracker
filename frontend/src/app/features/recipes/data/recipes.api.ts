import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { map, type Observable } from 'rxjs';

import { API_BASE_URL } from '../../../core/api/api.config';
import type {
  IngredientSource,
  NewRecipe,
  NewRecipeIngredient,
  Recipe,
  RecipeIngredient,
  RecipeMode,
} from '../models/recipe.models';

// Thin HttpClient wrapper over /api/recipes. The auth interceptor adds the Bearer token
// and withCredentials globally, so this only shapes requests and maps the wire DTOs to the
// app's internal Recipe. Nutrition arrives as a per-100g object and is flattened into the
// model's Per100g fields (and back) here, same as foods.api.ts does.

interface Per100gDto {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface RecipeIngredientDto {
  id: string;
  name: string;
  brand: string | null;
  source: IngredientSource;
  customFoodId: string | null;
  externalId: string | null;
  grams: number;
  per100g: Per100gDto;
}

interface RecipeDto {
  id: string;
  source: 'recipe';
  name: string;
  mode: RecipeMode;
  totalWeightG: number;
  per100g: Per100gDto;
  totals: Per100gDto;
  ingredients?: RecipeIngredientDto[];
}

@Service()
export class RecipesApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(API_BASE_URL)}/recipes`;

  /** The user's whole list, alphabetical and without ingredient arrays. */
  list(q?: string): Observable<Recipe[]> {
    return this.http
      .get<RecipeDto[]>(this.base, q ? { params: { q } } : {})
      .pipe(map((recipes) => recipes.map(toRecipe)));
  }

  /** The only call that returns ingredients — the list response omits them. */
  get(id: string): Observable<Recipe> {
    return this.http.get<RecipeDto>(`${this.base}/${id}`).pipe(map(toRecipe));
  }

  create(input: NewRecipe): Observable<Recipe> {
    return this.http.post<RecipeDto>(this.base, toBodyDto(input)).pipe(map(toRecipe));
  }

  /** A full replace, not a patch — ingredients included, so omitting one drops it. */
  update(id: string, input: NewRecipe): Observable<Recipe> {
    return this.http.put<RecipeDto>(`${this.base}/${id}`, toBodyDto(input)).pipe(map(toRecipe));
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }
}

function toIngredient(dto: RecipeIngredientDto): RecipeIngredient {
  return {
    id: dto.id,
    name: dto.name,
    brand: dto.brand,
    source: dto.source,
    customFoodId: dto.customFoodId,
    externalId: dto.externalId,
    grams: dto.grams,
    kcalPer100g: dto.per100g.kcal,
    proteinPer100g: dto.per100g.protein,
    carbsPer100g: dto.per100g.carbs,
    fatPer100g: dto.per100g.fat,
  };
}

// DTO → internal model: flatten the per-100g object into Per100g fields.
function toRecipe(dto: RecipeDto): Recipe {
  const recipe: Recipe = {
    id: dto.id,
    name: dto.name,
    mode: dto.mode,
    totalWeightG: dto.totalWeightG,
    totals: {
      kcal: dto.totals.kcal,
      protein: dto.totals.protein,
      carbs: dto.totals.carbs,
      fat: dto.totals.fat,
    },
    kcalPer100g: dto.per100g.kcal,
    proteinPer100g: dto.per100g.protein,
    carbsPer100g: dto.per100g.carbs,
    fatPer100g: dto.per100g.fat,
  };
  if (dto.ingredients) recipe.ingredients = dto.ingredients.map(toIngredient);
  return recipe;
}

/**
 * One ingredient as the request carries it.
 *
 * A custom food sends only an id and a portion: the server owns its nutrition and re-reads
 * it from `custom_foods`, so sending our copy would be at best redundant and at worst a way
 * to lie about it. Branching here makes that trust boundary visible from the client side
 * too — the same shape `diary.api.ts` uses for logging one.
 *
 * The fallback to 'manual' is the deleted-custom-food case: `custom_food_id` is
 * ON DELETE SET NULL, so an ingredient can come back as `source: 'custom'` with no id
 * behind it. Re-sending that as 'custom' would fail validation, and its snapshot is all
 * that is left of the food anyway.
 */
function toIngredientDto(ingredient: NewRecipeIngredient) {
  if (ingredient.source === 'custom' && ingredient.customFoodId) {
    return {
      source: 'custom' as const,
      customFoodId: ingredient.customFoodId,
      grams: ingredient.grams,
    };
  }

  return {
    source: ingredient.source === 'custom' ? ('manual' as const) : ingredient.source,
    name: ingredient.name,
    brand: ingredient.brand,
    grams: ingredient.grams,
    externalId: ingredient.externalId,
    per100g: {
      kcal: ingredient.kcalPer100g,
      protein: ingredient.proteinPer100g,
      carbs: ingredient.carbsPer100g,
      fat: ingredient.fatPer100g,
    },
  };
}

// Internal input → request body. The two modes send disjoint fields; the server's Zod is
// discriminated on `mode` and rejects anything that mixes them.
function toBodyDto(input: NewRecipe) {
  if (input.mode === 'manual') {
    return {
      name: input.name,
      mode: 'manual' as const,
      totalWeightG: input.totalWeightG,
      totals: input.totals,
    };
  }

  return {
    name: input.name,
    mode: 'ingredients' as const,
    totalWeightG: input.totalWeightG,
    ingredients: input.ingredients.map(toIngredientDto),
  };
}
