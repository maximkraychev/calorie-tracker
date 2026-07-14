import { Component, inject, input, output } from '@angular/core';

import { I18n } from '../../../core/i18n/i18n';
import { round } from '../../../shared/utils/nutrition.utils';
import { Icon } from '../../../shared/ui/icon';
import { EntryRow } from './entry-row';
import type { MealSection } from '../models/diary.models';

// One meal group (Breakfast/Lunch/Dinner/Snack): header + subtotal, its entry rows,
// an empty note, and an "Add food" action. `label` is passed in already translated so
// this component stays presentational.
@Component({
  selector: 'ct-meal-section',
  imports: [Icon, EntryRow],
  template: `
    <section class="meal">
      <header class="head">
        <h4>{{ label() }}</h4>
        <span class="text-muted sub">{{ round(section().subtotalKcal) }} {{ i18n.t('diary.kcal') }}</span>
      </header>

      @for (entry of section().entries; track entry.id) {
        <ct-entry-row [entry]="entry" (open)="openEntry.emit($event)" />
      }

      @if (section().entries.length === 0) {
        <div class="text-muted empty">{{ i18n.t('diary.nothingLogged') }}</div>
      }

      <button class="btn btn-ghost add" type="button" (click)="add.emit()">
        <ct-icon name="plus" />
        {{ i18n.t('diary.addFood') }}
      </button>
    </section>
  `,
  styles: `
    .meal { margin-bottom: var(--space-6); }
    .head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      padding-bottom: var(--space-2);
      border-bottom: 2px solid var(--color-divider);
    }
    h4 { margin: 0; font-size: 16px; letter-spacing: 0.04em; text-transform: uppercase; }
    .sub { font-size: 13px; font-family: var(--font-heading); font-weight: 800; }
    .empty {
      font-size: 13px;
      padding: var(--space-3) 0;
      border-bottom: 1px solid var(--color-divider);
    }
    .add { margin-top: var(--space-2); padding: var(--space-2) 0; }
  `,
})
export class MealSectionComponent {
  protected readonly i18n = inject(I18n);
  protected readonly round = round;

  readonly label = input.required<string>();
  readonly section = input.required<MealSection>();

  readonly add = output<void>();
  readonly openEntry = output<string>();
}
