import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { map, type Observable } from 'rxjs';

import { API_BASE_URL } from '../api/api.config';
import { toGoals, type DailyGoalDto, type EffectiveGoals, type Goals } from './goals.models';

// Thin HttpClient wrapper over /api/goals. The auth interceptor adds the Bearer token
// globally, so this only shapes requests and maps the wire DTO to the app's flat `Goals`.
//
// Both calls carry a *local* ISO date rather than letting the server pick one: the diary
// is keyed by the day the user is living in, so around midnight the server's own (UTC)
// date would file the goal a day off.

// `goal` is null until the user sets their first one, so the response wraps it — a bare
// `null` body is hard to tell from an empty one. A save has always just written a row,
// so its response is typed non-null.
interface GoalResponse {
  goal: DailyGoalDto | null;
}
interface SavedGoalResponse {
  goal: DailyGoalDto;
}

@Service()
export class GoalsApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(API_BASE_URL)}/goals`;

  /** The goal in force on `date`, or null if the user has never set one. */
  getGoal(date: string): Observable<EffectiveGoals | null> {
    return this.http
      .get<GoalResponse>(this.base, { params: { date } })
      .pipe(map((response) => (response.goal ? toEffectiveGoals(response.goal) : null)));
  }

  /**
   * Upsert the targets that apply from `effectiveDate` onward. Idempotent: saving twice
   * on the same date rewrites that day's row rather than adding to the history.
   */
  saveGoal(effectiveDate: string, goals: Goals): Observable<EffectiveGoals> {
    const body = {
      effectiveDate,
      kcalTarget: goals.kcal,
      proteinTargetG: goals.protein,
      carbsTargetG: goals.carbs,
      fatTargetG: goals.fat,
    };
    return this.http
      .put<SavedGoalResponse>(this.base, body)
      .pipe(map((response) => toEffectiveGoals(response.goal)));
  }
}

function toEffectiveGoals(dto: DailyGoalDto): EffectiveGoals {
  return { effectiveDate: dto.effectiveDate, goals: toGoals(dto) };
}
