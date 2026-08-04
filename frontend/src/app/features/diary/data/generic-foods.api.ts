import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { map, type Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';
import type { FoodPortion, FoodSearchResult } from '../models/food-search.models';

// Our own whole-food catalog: GET /api/foods/search, backed by `generic_foods` (seeded
// from USDA FoodData Central). This exists because Open Food Facts is a barcode
// database — excellent for packaged goods, close to useless for "banana" or "chicken
// breast", and no amount of re-ranking its results fixes a gap in its data.
//
// Unlike the OFF calls, this is a normal same-origin API request: it goes through the
// auth interceptor (the endpoint requires a Bearer token) and the error interceptor.
//
// Ranking is entirely server-side — head-noun match, whole-word vs prefix, and the row's
// own specificity boost — so there is deliberately no client re-ranking here, unlike
// food-search.api.ts which has to repair OFF's popularity ordering.
const SEARCH_LIMIT = 20;

interface GenericFoodItem {
  kind: 'generic';
  id: string;
  source: 'generic';
  externalId: string | null;
  name: string;
  nameBg: string | null;
  brand: string | null;
  category: string | null;
  per100g: { kcal: number; protein: number; carbs: number; fat: number };
  servingSizeG: number | null;
  portions: FoodPortion[];
}

interface SearchResponse {
  items?: GenericFoodItem[];
}

@Service()
export class GenericFoodsApi {
  private readonly http = inject(HttpClient);

  search(query: string): Observable<FoodSearchResult[]> {
    return this.http
      .get<SearchResponse>(`${environment.apiBaseUrl}/foods/search`, {
        params: { q: query, limit: SEARCH_LIMIT },
      })
      .pipe(map((response) => (response.items ?? []).map(toResult)));
  }
}

function toResult(item: GenericFoodItem): FoodSearchResult {
  return {
    // Namespaced so a USDA fdcId can never collide with an OFF barcode in the merged list.
    code: `usda:${item.externalId ?? item.id}`,
    name: item.name,
    nameBg: item.nameBg,
    brand: item.brand,
    source: 'generic',
    servingSizeG: item.servingSizeG,
    portions: item.portions,
    kcalPer100g: item.per100g.kcal,
    proteinPer100g: item.per100g.protein,
    carbsPer100g: item.per100g.carbs,
    fatPer100g: item.per100g.fat,
  };
}
