import { Component, computed, inject, input, output } from '@angular/core';

import { I18n } from '../../../core/i18n/i18n';
import { round, sumMacros } from '../../../shared/utils/nutrition.utils';
import { Icon } from '../../../shared/ui/icon';
import { EntryRow } from './entry-row';
import type { MealSection } from '../models/diary.models';

// Full-screen overlay for one meal of the current day: light totals card, the meal's entry
// rows (tap = edit), and add actions. Slides up over the diary; the entry-edit sheet
// (z 45) and Add-Food (z 55) stack above it.
@Component({
  selector: 'ct-meal-detail',
  imports: [Icon, EntryRow],
  template: `
    <div class="overlay">
      <header class="head">
        <button
          class="btn btn-icon"
          type="button"
          [attr.aria-label]="i18n.t('diary.back')"
          (click)="back.emit()"
        >
          <ct-icon name="arrow-left" />
        </button>
        <div class="title">
          <div class="title-meal">{{ label() }}</div>
          <div class="text-muted title-date">{{ dateSub() }}</div>
        </div>
        <button class="btn btn-primary" type="button" (click)="add.emit()">
          <ct-icon name="plus" />
          {{ i18n.t('diary.add') }}
        </button>
      </header>

      <div class="body">
        <div class="totals">
          <div class="totals-top">
            <span class="totals-kcal">{{ round(totals().kcal) }}</span>
            <span class="totals-label">{{ i18n.t('diary.kcal') }} · {{ itemsLabel() }}</span>
          </div>
          <div class="totals-macros">
            <div>{{ i18n.t('diary.protein') }}&nbsp;{{ round(totals().protein) }} g</div>
            <div>{{ i18n.t('diary.carbs') }}&nbsp;{{ round(totals().carbs) }} g</div>
            <div>{{ i18n.t('diary.fat') }}&nbsp;{{ round(totals().fat) }} g</div>
          </div>
        </div>

        <div class="items-head">
          <h4>{{ i18n.t('diary.items') }}</h4>
        </div>
        @for (entry of section().entries; track entry.id) {
          <ct-entry-row [entry]="entry" (open)="openEntry.emit($event)" />
        }
        @if (section().entries.length === 0) {
          <div class="text-muted empty">{{ i18n.t('diary.nothingLoggedMeal') }}</div>
        }

        <button class="btn btn-ghost add-more" type="button" (click)="add.emit()">
          <ct-icon name="plus" />
          {{ i18n.t('diary.addFoodTo', { meal: label() }) }}
        </button>
      </div>
    </div>
  `,
  styles: `
    .overlay {
      position: absolute;
      inset: 0;
      z-index: 35;
      background: var(--color-bg);
      display: flex;
      flex-direction: column;
      animation: ct-sheet 0.24s ease;
    }
    .head {
      flex: none;
      display: flex;
      align-items: center;
      gap: var(--space-2);
      padding: 0 var(--space-3);
      height: 52px;
      border-bottom: 2px solid var(--color-divider);
    }
    .head .btn-icon { border: 1px solid var(--color-divider); }
    .title { line-height: 1.05; margin-right: auto; }
    .title-meal {
      font-family: var(--font-heading);
      font-weight: 800;
      font-size: 16px;
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }
    .title-date { font-size: 11px; }

    .body { flex: 1; overflow-y: auto; padding: var(--space-4) var(--space-4) 40px; }
    .totals {
      background: var(--color-surface);
      color: var(--color-text);
      border: 1px solid var(--color-divider);
      border-radius: 16px;
      padding: var(--space-4);
      margin-bottom: var(--space-6);
      box-shadow: var(--shadow-sm);
    }
    .totals-top { display: flex; align-items: baseline; gap: var(--space-2); }
    .totals-kcal { font-family: var(--font-heading); font-weight: 800; font-size: 38px; line-height: 1; }
    .totals-label {
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      opacity: 0.7;
    }
    .totals-macros {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: var(--space-2);
      margin-top: var(--space-3);
      border-top: 1px solid var(--color-divider);
      padding-top: var(--space-3);
      font-size: 13px;
      opacity: 0.9;
    }

    .items-head {
      border-bottom: 2px solid var(--color-divider);
      padding-bottom: var(--space-2);
      margin-bottom: var(--space-2);
    }
    .items-head h4 {
      margin: 0;
      font-size: 14px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .empty {
      font-size: 13px;
      padding: var(--space-4) 0;
      border-bottom: 1px solid var(--color-divider);
    }
    .add-more { margin-top: var(--space-3); padding: var(--space-2) 0; }
  `,
})
export class MealDetail {
  protected readonly i18n = inject(I18n);
  protected readonly round = round;

  /** Translated meal name (kept presentational — the page resolves the label). */
  readonly label = input.required<string>();
  readonly section = input.required<MealSection>();
  readonly dateSub = input.required<string>();

  readonly back = output<void>();
  readonly add = output<void>();
  readonly openEntry = output<string>();

  protected readonly totals = computed(() => sumMacros(this.section().entries));

  protected readonly itemsLabel = computed(() => {
    const count = this.section().entries.length;
    return count === 1 ? this.i18n.t('diary.oneItem') : this.i18n.t('diary.manyItems', { n: count });
  });
}
