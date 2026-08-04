import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { map, type Observable } from 'rxjs';

import { API_BASE_URL } from '../../../core/api/api.config';
import type { FoodSource, LogEntry, MealType } from '../models/diary.models';

// Thin HttpClient wrapper over /api/diary. The auth interceptor adds the Bearer token
// and withCredentials globally, so this only shapes requests and maps the wire DTOs to
// the app's internal LogEntry. Nutrition arrives as a per-100g object over the wire and
// is flattened into LogEntry's Portion fields (and back) here.

// The fields needed to log a new item — a LogEntry minus its server-assigned id and the
// meal (which the POST carries at the batch level).
export type NewEntryInput = Omit<LogEntry, 'id' | 'mealType'>;

interface Per100gDto {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

// The diary entry as the backend returns it (ARCHITECTURE.md §4.4). We only consume a
// subset — the per-100g snapshot + identity — and recompute totals client-side.
interface DiaryEntryDto {
  id: string;
  date: string;
  meal: MealType;
  name: string;
  brand: string | null;
  source: FoodSource;
  grams: number;
  per100g: Per100gDto;
  servingSizeG: number | null;
  externalId: string | null;
  customFoodId: string | null;
  recipeId: string | null;
}

interface DiaryDayDto {
  date: string;
  goal: null;
  totals: Per100gDto;
  entries: DiaryEntryDto[];
}

// Three shapes, mirroring the backend's discriminated union. A custom food or a recipe
// sends only an id and a portion: the server owns their nutrition and re-reads (or
// re-derives) it, so sending our copy would be at best redundant and at worst a way to lie
// about it. The server would strip the extra fields anyway; branching here makes that
// boundary visible from the client side too.
type NewEntryItemDto =
  | { source: 'custom'; customFoodId: string; grams: number }
  | { source: 'recipe'; recipeId: string; grams: number }
  | {
      source: Exclude<FoodSource, 'custom' | 'recipe'>;
      name: string;
      brand: string | null;
      grams: number;
      per100g: Per100gDto;
      externalId: string | null;
    };

@Service()
export class DiaryApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(API_BASE_URL)}/diary`;

  /** All entries logged on `date`, in log order. */
  getDiary(date: string): Observable<LogEntry[]> {
    return this.http
      .get<DiaryDayDto>(this.base, { params: { date } })
      .pipe(map((day) => day.entries.map(toLogEntry)));
  }

  /** Log one or more items under a single date + meal. Returns the created entries. */
  addEntries(date: string, meal: MealType, items: NewEntryInput[]): Observable<LogEntry[]> {
    const body = { date, meal, items: items.map(toItemDto) };
    return this.http
      .post<DiaryEntryDto[]>(`${this.base}/entries`, body)
      .pipe(map((entries) => entries.map(toLogEntry)));
  }

  /** Move an entry to a different grams/meal/date. */
  updateEntry(
    id: string,
    patch: { grams?: number; meal?: MealType; date?: string },
  ): Observable<LogEntry> {
    return this.http
      .patch<DiaryEntryDto>(`${this.base}/entries/${id}`, patch)
      .pipe(map(toLogEntry));
  }

  deleteEntry(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/entries/${id}`);
  }
}

// DTO → internal LogEntry: flatten the per-100g object into Portion fields.
function toLogEntry(dto: DiaryEntryDto): LogEntry {
  return {
    id: dto.id,
    mealType: dto.meal,
    name: dto.name,
    brand: dto.brand,
    source: dto.source,
    externalId: dto.externalId,
    customFoodId: dto.customFoodId,
    recipeId: dto.recipeId,
    grams: dto.grams,
    kcalPer100g: dto.per100g.kcal,
    proteinPer100g: dto.per100g.protein,
    carbsPer100g: dto.per100g.carbs,
    fatPer100g: dto.per100g.fat,
  };
}

// Internal input → request DTO: gather the flat Portion fields into a per-100g object,
// unless the item is a custom food, in which case only its id and portion travel.
function toItemDto(input: NewEntryInput): NewEntryItemDto {
  if (input.source === 'custom' && input.customFoodId) {
    return { source: 'custom', customFoodId: input.customFoodId, grams: input.grams };
  }

  if (input.source === 'recipe' && input.recipeId) {
    return { source: 'recipe', recipeId: input.recipeId, grams: input.grams };
  }

  return {
    // The two server-owned sources are handled above; anything reaching here carries its
    // own nutrition. A 'custom'/'recipe' entry with no id behind it would be one whose
    // source row was deleted, which the diary never re-posts.
    source: input.source as Exclude<FoodSource, 'custom' | 'recipe'>,
    name: input.name,
    brand: input.brand,
    grams: input.grams,
    externalId: input.externalId,
    per100g: {
      kcal: input.kcalPer100g,
      protein: input.proteinPer100g,
      carbs: input.carbsPer100g,
      fat: input.fatPer100g,
    },
  };
}
