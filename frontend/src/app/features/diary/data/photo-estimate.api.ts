import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { map, type Observable } from 'rxjs';

import { API_BASE_URL } from '../../../core/api/api.config';
import type { Language } from '../../../core/i18n/translations';
import type {
  EstimateAlternative,
  EstimateConfidence,
  EstimateItem,
  PhotoEstimate,
} from '../models/photo-estimate.models';

// Thin wrapper over /api/estimates. Unlike the Open Food Facts APIs — which the browser
// calls directly — this goes through our own backend, because the vision and USDA keys
// must stay server-side. The auth interceptor adds the Bearer token automatically since
// the URL is under apiBaseUrl.
//
// Same flat/nested split as diary.api.ts: per-100g nutrition is an object on the wire and
// flat fields internally.

interface Per100gDto {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface AlternativeDto {
  fdcId: number;
  name: string;
  per100g: Per100gDto;
}

interface EstimateItemDto {
  id: string;
  displayName: string;
  grams: number;
  confidence: EstimateConfidence;
  unresolved: boolean;
  fdcId: number | null;
  per100g: Per100gDto;
  alternatives: AlternativeDto[];
}

interface PhotoEstimateDto {
  items: EstimateItemDto[];
  overallConfidence: EstimateConfidence;
  scaleReferenceUsed: string | null;
  hiddenFatsNote: string | null;
  clarifyingQuestion: string | null;
}

@Service()
export class PhotoEstimateApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(API_BASE_URL)}/estimates`;

  /**
   * Analyse a meal photo. `note` is free-text context ("fried in 2 tbsp of oil") and is
   * treated as authoritative by the prompt — it is the single largest accuracy lever, so
   * always pass it when the user wrote one.
   */
  analyze(photo: Blob, note: string, lang: Language): Observable<PhotoEstimate> {
    const form = new FormData();
    form.append('photo', photo, 'meal.jpg');
    form.append('locale', lang);
    if (note.trim()) form.append('note', note.trim());

    return this.http.post<PhotoEstimateDto>(`${this.base}/photo`, form).pipe(map(toEstimate));
  }

  /** USDA search, for adding an ingredient the model missed. Debounce the caller. */
  searchFoods(query: string): Observable<EstimateAlternative[]> {
    return this.http
      .get<AlternativeDto[]>(`${this.base}/foods`, { params: { q: query } })
      .pipe(map((foods) => foods.map(toAlternative)));
  }
}

function toEstimate(dto: PhotoEstimateDto): PhotoEstimate {
  return {
    items: dto.items.map(toItem),
    overallConfidence: dto.overallConfidence,
    scaleReferenceUsed: dto.scaleReferenceUsed,
    hiddenFatsNote: dto.hiddenFatsNote,
    clarifyingQuestion: dto.clarifyingQuestion,
  };
}

function toItem(dto: EstimateItemDto): EstimateItem {
  return {
    id: dto.id,
    displayName: dto.displayName,
    grams: dto.grams,
    confidence: dto.confidence,
    unresolved: dto.unresolved,
    fdcId: dto.fdcId,
    ...flatten(dto.per100g),
    alternatives: dto.alternatives.map(toAlternative),
  };
}

function toAlternative(dto: AlternativeDto): EstimateAlternative {
  return { fdcId: dto.fdcId, name: dto.name, ...flatten(dto.per100g) };
}

function flatten(per100g: Per100gDto) {
  return {
    kcalPer100g: per100g.kcal,
    proteinPer100g: per100g.protein,
    carbsPer100g: per100g.carbs,
    fatPer100g: per100g.fat,
  };
}
