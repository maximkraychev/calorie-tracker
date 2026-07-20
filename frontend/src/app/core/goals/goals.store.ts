import { effect, inject, Service, signal } from '@angular/core';

import { AuthStore } from '../auth/auth.store';

// Daily nutrition targets. They drive the diary's calorie ring, macro bars, and the
// "kcal left / over" readout; edited in the Daily Goals sheet.
export interface Goals {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

// Prototype defaults, used until the user saves their own targets.
export const DEFAULT_GOALS: Goals = { kcal: 2200, protein: 140, carbs: 220, fat: 70 };

const STORAGE_PREFIX = 'ct.goals';

@Service()
export class GoalsStore {
  private readonly auth = inject(AuthStore);

  private readonly _goals = signal<Goals>(DEFAULT_GOALS);
  readonly goals = this._goals.asReadonly();

  constructor() {
    // Targets are per-user (keyed by user id), so reload whenever the session changes.
    effect(() => this._goals.set(this.load(this.storageKey())));
  }

  save(goals: Goals): void {
    const clean: Goals = {
      kcal: sanitize(goals.kcal, DEFAULT_GOALS.kcal),
      protein: sanitize(goals.protein, DEFAULT_GOALS.protein),
      carbs: sanitize(goals.carbs, DEFAULT_GOALS.carbs),
      fat: sanitize(goals.fat, DEFAULT_GOALS.fat),
    };
    this._goals.set(clean);
    try {
      localStorage.setItem(this.storageKey(), JSON.stringify(clean));
    } catch {
      // localStorage can be unavailable (private mode); goals just won't persist.
    }
  }

  private storageKey(): string {
    const userId = this.auth.user()?.id;
    return userId ? `${STORAGE_PREFIX}.${userId}` : STORAGE_PREFIX;
  }

  private load(key: string): Goals {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return DEFAULT_GOALS;
      const parsed = JSON.parse(raw) as Partial<Goals>;
      return {
        kcal: sanitize(parsed.kcal, DEFAULT_GOALS.kcal),
        protein: sanitize(parsed.protein, DEFAULT_GOALS.protein),
        carbs: sanitize(parsed.carbs, DEFAULT_GOALS.carbs),
        fat: sanitize(parsed.fat, DEFAULT_GOALS.fat),
      };
    } catch {
      return DEFAULT_GOALS;
    }
  }
}

// A goal must be a non-negative finite number; anything else falls back to the default.
function sanitize(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}
