import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { map, type Observable } from 'rxjs';

import { API_BASE_URL } from '../../../core/api/api.config';
import type { CustomFood, NewCustomFood } from '../models/custom-food.models';

// Thin HttpClient wrapper over /api/foods (ARCHITECTURE.md §4.2). The auth interceptor
// adds the Bearer token; this only shapes requests and maps between the wire DTO (which
// nests `per100g`) and the app's flattened CustomFood, exactly like diary.api.ts.
//
// Note this is a different endpoint from GET /api/foods/search, which serves the
// read-only USDA catalog and lives in features/diary/data/generic-foods.api.ts.

interface Per100gDto {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface CustomFoodDto {
  id: string;
  source: 'custom';
  externalId: null;
  name: string;
  brand: string | null;
  per100g: Per100gDto;
  servingSizeG: number | null;
}

@Service()
export class FoodsApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(API_BASE_URL)}/foods`;

  /** The user's whole catalog, alphabetical. `q` narrows it server-side when given. */
  list(q?: string): Observable<CustomFood[]> {
    return this.http
      .get<CustomFoodDto[]>(this.base, q ? { params: { q } } : {})
      .pipe(map((foods) => foods.map(toCustomFood)));
  }

  create(input: NewCustomFood): Observable<CustomFood> {
    return this.http.post<CustomFoodDto>(this.base, toBodyDto(input)).pipe(map(toCustomFood));
  }

  /** A full replace, not a patch — omitted optional fields are cleared server-side. */
  update(id: string, input: NewCustomFood): Observable<CustomFood> {
    return this.http
      .put<CustomFoodDto>(`${this.base}/${id}`, toBodyDto(input))
      .pipe(map(toCustomFood));
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }
}

// DTO → internal model: flatten the per-100g object into Per100g fields.
function toCustomFood(dto: CustomFoodDto): CustomFood {
  return {
    id: dto.id,
    name: dto.name,
    brand: dto.brand,
    servingSizeG: dto.servingSizeG,
    kcalPer100g: dto.per100g.kcal,
    proteinPer100g: dto.per100g.protein,
    carbsPer100g: dto.per100g.carbs,
    fatPer100g: dto.per100g.fat,
  };
}

// Internal input → request body: gather the flat fields back into a per-100g object.
function toBodyDto(input: NewCustomFood) {
  return {
    name: input.name,
    brand: input.brand,
    servingSizeG: input.servingSizeG,
    per100g: {
      kcal: input.kcalPer100g,
      protein: input.proteinPer100g,
      carbs: input.carbsPer100g,
      fat: input.fatPer100g,
    },
  };
}
