import { computed, Service, signal } from '@angular/core';

import { isoDateForOffset } from '../../../shared/utils/date.utils';
import { sumMacros } from '../../../shared/utils/nutrition.utils';
import { seedDiary } from './diary.seed';
import { MEAL_ORDER, type LogEntry, type MealSection, type MealType } from '../models/diary.models';

// Diary state for the selected day. Root-provided so the chosen day and entries
// survive tab navigation. In-memory for now (seeded); a diary API will replace the
// seed and back the mutations once the backend exposes those endpoints.
@Service()
export class DiaryStore {
  private readonly _dayOffset = signal(0);
  private readonly _entriesByDate = signal<Record<string, LogEntry[]>>(seedDiary());
  private readonly _mealDetail = signal<MealType | null>(null);
  private readonly _entryEditId = signal<string | null>(null);

  /** Days from today (0 = today, -1 = yesterday). */
  readonly dayOffset = this._dayOffset.asReadonly();
  readonly currentDate = computed(() => isoDateForOffset(this._dayOffset()));
  readonly isToday = computed(() => this._dayOffset() === 0);

  readonly entries = computed(() => this._entriesByDate()[this.currentDate()] ?? []);
  readonly totals = computed(() => sumMacros(this.entries()));

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

  addEntry(entry: Omit<LogEntry, 'id'>): void {
    const newEntry: LogEntry = { ...entry, id: crypto.randomUUID() };
    this.mutateDay((entries) => [...entries, newEntry]);
  }

  updateEntryGrams(id: string, grams: number): void {
    this.mutateDay((entries) =>
      entries.map((entry) => (entry.id === id ? { ...entry, grams } : entry)),
    );
  }

  removeEntry(id: string): void {
    this.mutateDay((entries) => entries.filter((entry) => entry.id !== id));
  }

  // Immutably replace the current day's entry list.
  private mutateDay(update: (entries: LogEntry[]) => LogEntry[]): void {
    const date = this.currentDate();
    this._entriesByDate.update((byDate) => ({
      ...byDate,
      [date]: update(byDate[date] ?? []),
    }));
  }
}
