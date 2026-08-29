import { Component, computed, inject } from '@angular/core';

import { I18n } from '../../../core/i18n/i18n';
import { GoalsStore } from '../../../core/goals/goals.store';
import type { Goals } from '../../../core/goals/goals.models';
import { AccountSheet } from '../../../core/layout/account-sheet.store';
import { startOfDay } from '../../../shared/utils/date.utils';
import { Icon } from '../../../shared/ui/icon';
import { DiaryStore } from '../data/diary.store';
import { DailyTotals } from '../components/daily-totals';
import { MealCard } from '../components/meal-card';
import { MealDetail } from '../components/meal-detail';
import { EntryEditSheet } from '../components/entry-edit-sheet';
import { AddFoodOverlay } from '../components/add-food-overlay';
import { MEAL_LABEL_KEYS, type LogEntry, type MealType } from '../models/diary.models';

// Home screen: date navigator, the day's totals panel (calorie ring + macro bars vs.
// the daily goals), and one summary card per meal. Meal cards open the meal-detail
// overlay; its items open the entry-edit sheet, both rendered here above the page.
@Component({
  selector: 'ct-diary-page',
  imports: [Icon, DailyTotals, MealCard, MealDetail, EntryEditSheet, AddFoodOverlay],
  template: `
    <div class="page">
      <div class="datenav">
        <button
          class="btn btn-icon"
          type="button"
          [attr.aria-label]="i18n.t('diary.previousDay')"
          (click)="store.previousDay()"
        >
          <ct-icon name="chevron-left" />
        </button>
        <div class="date">
          <div class="date-label">{{ dateLabel() }}</div>
          <div class="text-muted date-sub">{{ dateSub() }}</div>
        </div>
        <button
          class="btn btn-icon"
          type="button"
          [attr.aria-label]="i18n.t('diary.nextDay')"
          (click)="store.nextDay()"
        >
          <ct-icon name="chevron-right" />
        </button>
        <button
          class="btn btn-icon account"
          type="button"
          [attr.aria-label]="i18n.t('account.title')"
          (click)="accountSheet.show()"
        >
          <ct-icon name="user" />
        </button>
      </div>

      @if (!store.isToday()) {
        <button class="btn btn-secondary jump" type="button" (click)="store.goToday()">
          {{ i18n.t('diary.jumpToToday') }}
        </button>
      }

      @if (store.status() === 'error') {
        <div class="load-error" role="alert">
          <span>{{ i18n.t('diary.loadError') }}</span>
          <button class="btn btn-secondary" type="button" (click)="store.reload()">
            {{ i18n.t('diary.retry') }}
          </button>
        </div>
      } @else if (store.status() === 'loading' && store.entries().length === 0) {
        <div class="loading text-muted" role="status">{{ i18n.t('diary.loading') }}</div>
      }

      <ct-daily-totals [totals]="store.totals()" [goals]="goals()" />

      <div class="meals-head">
        <h4>{{ i18n.t('diary.meals') }}</h4>
      </div>
      @for (section of store.mealSections(); track section.type) {
        <ct-meal-card
          [label]="mealLabel(section.type)"
          [section]="section"
          (open)="store.openMealDetail(section.type)"
          (add)="onAdd(section.type)"
        />
      }
    </div>

    @if (store.mealDetailSection(); as section) {
      <ct-meal-detail
        [label]="mealLabel(section.type)"
        [section]="section"
        [dateSub]="dateSub()"
        (back)="store.closeMealDetail()"
        (add)="onAdd(section.type)"
        (openEntry)="store.openEntryEdit($event)"
      />
    }

    @if (store.entryEdit(); as entry) {
      <ct-entry-edit-sheet
        [entry]="entry"
        (close)="store.closeEntryEdit()"
        (save)="saveEntry(entry.id, $event)"
        (delete)="deleteEntry(entry.id)"
      />
    }

    @if (store.addFood(); as meal) {
      <ct-add-food-overlay
        [meal]="meal"
        (close)="store.closeAddFood()"
        (log)="logFood($event)"
        (logMany)="logFoods($event)"
      />
    }
  `,
  styles: `
    .page { padding: var(--space-4) var(--space-4) 90px; }
    .datenav {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      margin-bottom: var(--space-4);
    }
    .datenav .btn-icon { border: 1px solid var(--color-divider); }
    .datenav .account { margin-left: var(--space-2); }
    .date { flex: 1; text-align: center; line-height: 1.1; }
    .date-label { font-family: var(--font-heading); font-weight: 800; font-size: 18px; }
    .date-sub { font-size: 12px; }
    .jump { width: 100%; justify-content: center; margin-bottom: var(--space-4); }

    .loading { text-align: center; padding: var(--space-3) 0; font-size: 13px; }
    .load-error {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
      padding: var(--space-3) var(--space-4);
      margin-bottom: var(--space-4);
      border: 1px solid var(--color-divider);
      border-radius: 12px;
      background: var(--color-surface);
      font-size: 14px;
    }

    .meals-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      border-bottom: 2px solid var(--color-divider);
      padding-bottom: var(--space-2);
      margin-bottom: var(--space-3);
    }
    .meals-head h4 {
      margin: 0;
      font-size: 15px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
  `,
})
export class DiaryPage {
  protected readonly i18n = inject(I18n);
  protected readonly store = inject(DiaryStore);
  protected readonly goalsStore = inject(GoalsStore);
  protected readonly accountSheet = inject(AccountSheet);

  /**
   * The targets this day is judged against. Goals are effective-dated, so a past day uses
   * the goal the server says applied then (`store.dayGoal()`), while today and any day
   * after the current goal took effect use the live one — that way a goal saved in the
   * sheet shows up on the ring immediately, with no refetch of the loaded days.
   *
   * A day earlier than the user's first goal has none of its own; showing the current
   * targets there beats showing the built-in defaults.
   */
  protected readonly goals = computed<Goals>(() =>
    this.store.currentDate() >= this.goalsStore.effectiveFrom()
      ? this.goalsStore.goals()
      : (this.store.dayGoal() ?? this.goalsStore.goals()),
  );

  protected readonly dateLabel = computed(() => {
    const offset = this.store.dayOffset();
    if (offset === 0) return this.i18n.t('diary.today');
    if (offset === -1) return this.i18n.t('diary.yesterday');
    if (offset === 1) return this.i18n.t('diary.tomorrow');
    return startOfDay(offset).toLocaleDateString(this.i18n.locale(), {
      month: 'short',
      day: 'numeric',
    });
  });

  protected readonly dateSub = computed(() =>
    startOfDay(this.store.dayOffset()).toLocaleDateString(this.i18n.locale(), {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }),
  );

  protected mealLabel(type: MealType): string {
    return this.i18n.t(MEAL_LABEL_KEYS[type]);
  }

  protected saveEntry(id: string, grams: number): void {
    this.store.updateEntryGrams(id, grams);
    this.store.closeEntryEdit();
  }

  protected deleteEntry(id: string): void {
    this.store.removeEntry(id);
    this.store.closeEntryEdit();
  }

  protected onAdd(meal: MealType): void {
    this.store.openAddFood(meal);
  }

  protected logFood(entry: Omit<LogEntry, 'id'>): void {
    this.store.addEntry(entry);
    this.store.closeAddFood();
  }

  /** A photo estimate confirmed — several ingredients logged in one batch. */
  protected logFoods(entries: Omit<LogEntry, 'id'>[]): void {
    this.store.addEntries(entries);
    this.store.closeAddFood();
  }
}
