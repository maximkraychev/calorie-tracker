import { effect, inject, Service, signal } from '@angular/core';

import { isoDateForOffset } from '../../shared/utils/date.utils';
import { AuthStore } from '../auth/auth.store';
import { GoalsApi } from './goals.api';
import { DEFAULT_GOALS, sanitizeGoals, type EffectiveGoals, type Goals } from './goals.models';

const STORAGE_PREFIX = 'ct.goals';

/** Today as a local ISO date — goals are filed against the day the user is living in. */
function today(): string {
  return isoDateForOffset(0);
}

// The user's daily targets, owned server-side by the `goals` table (effective-dated).
//
// This store holds the goal in force *today*: what the Daily Goals sheet edits, and what
// the diary falls back to. It deliberately keeps no history — a past diary day gets the
// targets that applied then from its own /api/diary response, so there is one place that
// answers "which goal governed this day" and it is the server.
//
// localStorage is a cache, not the source of truth. It paints the ring at the right
// numbers before the fetch lands and keeps the app usable offline (this is a PWA); the
// server's answer overwrites it as soon as it arrives.
@Service()
export class GoalsStore {
  private readonly api = inject(GoalsApi);
  private readonly auth = inject(AuthStore);

  private readonly _goals = signal<Goals>(DEFAULT_GOALS);
  private readonly _effectiveFrom = signal<string>(today());

  readonly goals = this._goals.asReadonly();

  /**
   * The date `goals()` took effect. Every day on or after it is governed by these
   * targets, which is what lets the diary reflect a just-saved goal — for today and any
   * later day on screen — without refetching those days.
   */
  readonly effectiveFrom = this._effectiveFrom.asReadonly();

  constructor() {
    // Targets are per-user, so re-read whenever the session changes: sign in and the
    // cache paints immediately while the fetch confirms; sign out and the numbers drop
    // back to the defaults rather than leaving the previous user's on screen.
    effect(() => {
      const userId = this.auth.user()?.id;
      if (!userId) {
        this.apply({ effectiveDate: today(), goals: DEFAULT_GOALS });
        return;
      }

      // Paint the cache (or the defaults) right away, then confirm against the server.
      // Always writing something means a user whose browser has no cache can't be left
      // looking at the previous session's numbers.
      const cached = this.readCache(userId);
      this.apply({ effectiveDate: today(), goals: cached ?? DEFAULT_GOALS });
      this.fetch(userId);
    });
  }

  /**
   * Persist new targets, effective from today. Applied optimistically so the diary
   * updates the moment the sheet closes; the stored row then replaces it, and a failed
   * request rolls back to the previous goal.
   */
  save(goals: Goals): void {
    const clean = sanitizeGoals(goals);
    const previous: EffectiveGoals = {
      effectiveDate: this._effectiveFrom(),
      goals: this._goals(),
    };
    const userId = this.auth.user()?.id;
    const date = today();

    this.apply({ effectiveDate: date, goals: clean });
    this.writeCache(userId, clean);

    this.api.saveGoal(date, clean).subscribe({
      next: (stored) => {
        this.apply(stored);
        this.writeCache(userId, stored.goals);
      },
      error: () => {
        this.apply(previous);
        this.writeCache(userId, previous.goals);
      },
    });
  }

  private fetch(userId: string): void {
    this.api.getGoal(today()).subscribe({
      next: (stored) => {
        if (stored) {
          this.apply(stored);
          this.writeCache(userId, stored.goals);
          return;
        }
        // The server has no goal for this user. If the browser is still holding targets
        // from before goals were stored server-side, adopt them once instead of silently
        // resetting the user to the defaults.
        const cached = this.readCache(userId);
        if (cached) this.save(cached);
      },
      // Offline or a failed request: keep whatever the cache already painted.
      error: () => {},
    });
  }

  private apply(stored: EffectiveGoals): void {
    this._goals.set(stored.goals);
    this._effectiveFrom.set(stored.effectiveDate);
  }

  private storageKey(userId: string): string {
    return `${STORAGE_PREFIX}.${userId}`;
  }

  private readCache(userId: string): Goals | null {
    try {
      const raw = localStorage.getItem(this.storageKey(userId));
      return raw ? sanitizeGoals(JSON.parse(raw) as Partial<Goals>) : null;
    } catch {
      // Unavailable (private mode) or corrupt — fall through to the server.
      return null;
    }
  }

  private writeCache(userId: string | undefined, goals: Goals): void {
    if (!userId) return;
    try {
      localStorage.setItem(this.storageKey(userId), JSON.stringify(goals));
    } catch {
      // localStorage can be unavailable; the goal is on the server either way.
    }
  }
}
