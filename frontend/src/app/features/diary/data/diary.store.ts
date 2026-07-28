import { computed, effect, inject, Service, signal } from '@angular/core';

import { isoDateForOffset } from '../../../shared/utils/date.utils';
import { sumMacros } from '../../../shared/utils/nutrition.utils';
import { DiaryApi } from './diary.api';
import { MEAL_ORDER, type LogEntry, type MealSection, type MealType } from '../models/diary.models';

// Load state for a single day's entries.
type DayStatus = 'loading' | 'ready' | 'error';

// Diary state for the selected day. Root-provided so the chosen day and entries survive
// tab navigation. Entries are fetched per day from /api/diary and cached here; mutations
// are optimistic (applied immediately, reconciled or rolled back on the API response).
@Service()
export class DiaryStore {
  private readonly api = inject(DiaryApi);

  private readonly _dayOffset = signal(0);
  private readonly _entriesByDate = signal<Record<string, LogEntry[]>>({});
  private readonly _statusByDate = signal<Record<string, DayStatus>>({});
  private readonly _mealDetail = signal<MealType | null>(null);
  private readonly _entryEditId = signal<string | null>(null);
  private readonly _addFoodMeal = signal<MealType | null>(null);

  // Days we've already kicked off a fetch for — non-reactive so the load effect depends
  // only on the current date, not on load state (which would make it re-enter itself).
  private readonly requested = new Set<string>();

  /** Days from today (0 = today, -1 = yesterday). */
  readonly dayOffset = this._dayOffset.asReadonly();
  readonly currentDate = computed(() => isoDateForOffset(this._dayOffset()));
  readonly isToday = computed(() => this._dayOffset() === 0);

  readonly entries = computed(() => this._entriesByDate()[this.currentDate()] ?? []);
  readonly totals = computed(() => sumMacros(this.entries()));

  /** Load state of the day currently shown — drives the page's spinner / retry. */
  readonly status = computed<DayStatus>(() => this._statusByDate()[this.currentDate()] ?? 'loading');

  readonly mealSections = computed<MealSection[]>(() => {
    const entries = this.entries();
    return MEAL_ORDER.map((type) => {
      const mealEntries = entries.filter((entry) => entry.mealType === type);
      return { type, entries: mealEntries, subtotalKcal: sumMacros(mealEntries).kcal };
    });
  });

  /** Which meal's detail overlay is open (null = none). */
  readonly mealDetail = this._mealDetail.asReadonly();
  readonly mealDetailSection = computed<MealSection | null>(() => {
    const meal = this._mealDetail();
    return meal ? (this.mealSections().find((section) => section.type === meal) ?? null) : null;
  });

  /** The entry open in the edit sheet (null = closed, or the entry no longer exists). */
  readonly entryEdit = computed<LogEntry | null>(() => {
    const id = this._entryEditId();
    return id ? (this.entries().find((entry) => entry.id === id) ?? null) : null;
  });

  /** Which meal the Add-Food overlay targets (null = closed). */
  readonly addFood = this._addFoodMeal.asReadonly();

  constructor() {
    // Fetch each day the first time it's shown. The effect tracks only `currentDate`;
    // `requested` (a plain Set) dedupes so navigating back to a loaded day doesn't refetch.
    effect(() => {
      const date = this.currentDate();
      if (!this.requested.has(date)) this.load(date);
    });
  }

  /** Re-fetch the current day (used by the page's retry after a load error). */
  reload(): void {
    this.requested.delete(this.currentDate());
    this.load(this.currentDate());
  }

  openAddFood(meal: MealType): void {
    this._addFoodMeal.set(meal);
  }

  closeAddFood(): void {
    this._addFoodMeal.set(null);
  }

  openMealDetail(meal: MealType): void {
    this._mealDetail.set(meal);
  }

  closeMealDetail(): void {
    this._mealDetail.set(null);
  }

  openEntryEdit(id: string): void {
    this._entryEditId.set(id);
  }

  closeEntryEdit(): void {
    this._entryEditId.set(null);
  }

  previousDay(): void {
    this._dayOffset.update((offset) => offset - 1);
  }

  nextDay(): void {
    this._dayOffset.update((offset) => offset + 1);
  }

  goToday(): void {
    this._dayOffset.set(0);
  }

  // Log a food. Shown immediately with a temporary id, then swapped for the server row
  // (which carries the real id); on failure the optimistic row is removed.
  addEntry(entry: Omit<LogEntry, 'id'>): void {
    const date = this.currentDate();
    const tempId = `temp-${crypto.randomUUID()}`;
    this.mutateDate(date, (entries) => [...entries, { ...entry, id: tempId }]);

    const { mealType, ...item } = entry;
    this.api.addEntries(date, mealType, [item]).subscribe({
      next: ([created]) =>
        this.mutateDate(date, (entries) =>
          entries.map((e) => (e.id === tempId && created ? created : e)),
        ),
      error: () => this.mutateDate(date, (entries) => entries.filter((e) => e.id !== tempId)),
    });
  }

  // Log several foods at once — a photo estimate returns a whole meal's ingredients.
  // Same optimistic contract as addEntry, but the batch succeeds or rolls back together,
  // since the API writes it in one request.
  addEntries(entries: readonly Omit<LogEntry, 'id'>[]): void {
    const [first] = entries;
    if (!first) return;

    const date = this.currentDate();
    const staged = entries.map((entry) => ({ ...entry, id: `temp-${crypto.randomUUID()}` }));
    const tempIds = new Set(staged.map((entry) => entry.id));
    this.mutateDate(date, (existing) => [...existing, ...staged]);

    // The API batches under a single date + meal, and the overlay logs into one meal.
    const items = staged.map(({ id, mealType, ...item }) => item);
    this.api.addEntries(date, first.mealType, items).subscribe({
      next: (created) =>
        this.mutateDate(date, (existing) => {
          // Swap each staged row for its server row in place, so the day keeps its order.
          const incoming = [...created];
          return existing.flatMap((entry) => {
            if (!tempIds.has(entry.id)) return [entry];
            const server = incoming.shift();
            return server ? [server] : [];
          });
        }),
      error: () =>
        this.mutateDate(date, (existing) => existing.filter((entry) => !tempIds.has(entry.id))),
    });
  }

  updateEntryGrams(id: string, grams: number): void {
    const date = this.currentDate();
    const previous = this.entries().find((entry) => entry.id === id);
    if (!previous) return;

    this.mutateDate(date, (entries) => entries.map((e) => (e.id === id ? { ...e, grams } : e)));
    this.api.updateEntry(id, { grams }).subscribe({
      next: (updated) =>
        this.mutateDate(date, (entries) => entries.map((e) => (e.id === id ? updated : e))),
      error: () =>
        this.mutateDate(date, (entries) => entries.map((e) => (e.id === id ? previous : e))),
    });
  }

  removeEntry(id: string): void {
    const date = this.currentDate();
    const snapshot = this.entries();
    this.mutateDate(date, (entries) => entries.filter((e) => e.id !== id));
    this.api.deleteEntry(id).subscribe({
      // Restore the whole day's list on failure (simplest correct rollback).
      error: () => this._entriesByDate.update((byDate) => ({ ...byDate, [date]: snapshot })),
    });
  }

  private load(date: string): void {
    this.requested.add(date);
    this.setStatus(date, 'loading');
    this.api.getDiary(date).subscribe({
      next: (entries) => {
        this._entriesByDate.update((byDate) => ({ ...byDate, [date]: entries }));
        this.setStatus(date, 'ready');
      },
      error: () => this.setStatus(date, 'error'),
    });
  }

  private setStatus(date: string, status: DayStatus): void {
    this._statusByDate.update((byDate) => ({ ...byDate, [date]: status }));
  }

  // Immutably replace one day's entry list.
  private mutateDate(date: string, update: (entries: LogEntry[]) => LogEntry[]): void {
    this._entriesByDate.update((byDate) => ({
      ...byDate,
      [date]: update(byDate[date] ?? []),
    }));
  }
}
