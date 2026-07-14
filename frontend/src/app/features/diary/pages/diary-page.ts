import { Component, computed, inject } from '@angular/core';

import { I18n } from '../../../core/i18n/i18n';
import type { TranslationKey } from '../../../core/i18n/translations';
import { startOfDay } from '../../../shared/utils/date.utils';
import { round } from '../../../shared/utils/nutrition.utils';
import { Icon } from '../../../shared/ui/icon';
import { DiaryStore } from '../data/diary.store';
import { MealSectionComponent } from '../components/meal-section';
import type { MealType } from '../models/diary.models';

const MEAL_LABEL_KEYS: Record<MealType, TranslationKey> = {
  breakfast: 'meal.breakfast',
  lunch: 'meal.lunch',
  dinner: 'meal.dinner',
  snack: 'meal.snack',
};

// Home screen: date navigator, the day's totals ink-block, and the four meal sections.
@Component({
  selector: 'ct-diary-page',
  imports: [Icon, MealSectionComponent],
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
      </div>

      @if (!store.isToday()) {
        <button class="btn btn-secondary jump" type="button" (click)="store.goToday()">
          {{ i18n.t('diary.jumpToToday') }}
        </button>
      }

      <div class="totals">
        <div class="totals-top">
          <span class="total-kcal">{{ round(store.totals().kcal) }}</span>
          <span class="total-kcal-label">{{ i18n.t('diary.kcalToday') }}</span>
        </div>
        <div class="macros">
          <div class="macro divider-r">
            <div class="macro-label">{{ i18n.t('diary.protein') }}</div>
            <div class="macro-value">{{ round(store.totals().protein) }}<span class="unit"> g</span></div>
          </div>
          <div class="macro divider-r">
            <div class="macro-label">{{ i18n.t('diary.carbs') }}</div>
            <div class="macro-value">{{ round(store.totals().carbs) }}<span class="unit"> g</span></div>
          </div>
          <div class="macro">
            <div class="macro-label">{{ i18n.t('diary.fat') }}</div>
            <div class="macro-value">{{ round(store.totals().fat) }}<span class="unit"> g</span></div>
          </div>
        </div>
      </div>

      @for (section of store.mealSections(); track section.type) {
        <ct-meal-section
          [label]="mealLabel(section.type)"
          [section]="section"
          (add)="onAdd(section.type)"
          (openEntry)="onOpenEntry($event)"
        />
      }
    </div>
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
    .date { flex: 1; text-align: center; line-height: 1.1; }
    .date-label { font-family: var(--font-heading); font-weight: 800; font-size: 18px; }
    .date-sub { font-size: 12px; }
    .jump { width: 100%; justify-content: center; margin-bottom: var(--space-4); }

    .totals {
      background: var(--color-text);
      color: var(--color-bg);
      padding: var(--space-4);
      margin-bottom: var(--space-6);
    }
    .totals-top { display: flex; align-items: baseline; gap: var(--space-2); }
    .total-kcal { font-family: var(--font-heading); font-weight: 800; font-size: 44px; line-height: 0.9; }
    .total-kcal-label {
      font-size: 13px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      opacity: 0.7;
    }
    .macros {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      margin-top: var(--space-4);
      padding-top: var(--space-3);
      border-top: 1px solid rgba(255, 255, 255, 0.25);
    }
    .macro { padding: 0 var(--space-2); }
    .macro:first-child { padding-left: 0; }
    .macro:last-child { padding-right: 0; }
    .divider-r { border-right: 1px solid rgba(255, 255, 255, 0.25); }
    .macro-label {
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      opacity: 0.6;
    }
    .macro-value { font-family: var(--font-heading); font-weight: 800; font-size: 22px; }
    .unit { font-size: 12px; opacity: 0.6; }
  `,
})
export class DiaryPage {
  protected readonly i18n = inject(I18n);
  protected readonly store = inject(DiaryStore);
  protected readonly round = round;

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

  // TODO(next pass): open the Add-Food sheet pre-targeted to this meal.
  protected onAdd(_meal: MealType): void {}

  // TODO(next pass): open the Entry-Edit bottom sheet for this entry.
  protected onOpenEntry(_entryId: string): void {}
}
