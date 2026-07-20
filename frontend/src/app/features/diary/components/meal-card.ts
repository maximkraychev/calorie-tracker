import { Component, computed, inject, input, output } from '@angular/core';

import { I18n } from '../../../core/i18n/i18n';
import { round } from '../../../shared/utils/nutrition.utils';
import { Icon } from '../../../shared/ui/icon';
import type { MealSection } from '../models/diary.models';

// One meal's summary card on the diary: name + item count + kcal subtotal, opening the
// meal-detail overlay, plus a separate right-edge "+" button that jumps straight to
// Add-Food for this meal. Two sibling buttons — the "+" must never trigger the card tap.
@Component({
  selector: 'ct-meal-card',
  imports: [Icon],
  template: `
    <div class="card">
      <button class="body" type="button" (click)="open.emit()">
        <div class="info">
          <div class="name">{{ label() }}</div>
          <div class="text-muted items">{{ itemsLabel() }}</div>
        </div>
        <div class="kcal-col">
          <div class="kcal">{{ round(section().subtotalKcal) }}</div>
          <div class="text-muted unit">{{ i18n.t('diary.kcal') }}</div>
        </div>
        <ct-icon name="chevron-right" class="chev" />
      </button>
      <button
        class="add"
        type="button"
        [attr.aria-label]="i18n.t('diary.addFoodTo', { meal: label() })"
        (click)="add.emit()"
      >
        <ct-icon name="plus" />
      </button>
    </div>
  `,
  styles: `
    .card {
      display: flex;
      align-items: stretch;
      border: 1px solid var(--color-divider);
      border-radius: 16px;
      overflow: hidden;
      margin-bottom: var(--space-3);
      background: var(--color-surface);
      box-shadow: var(--shadow-sm);
    }
    .body {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: var(--space-3);
      text-align: left;
      padding: var(--space-3);
      border: 0;
      background: transparent;
      cursor: pointer;
      color: inherit;
      font: inherit;
      transition: background 0.15s ease;
    }
    .body:hover { background: var(--color-neutral-100); }
    .info { flex: 1; min-width: 0; }
    .name {
      font-family: var(--font-heading);
      font-weight: 800;
      font-size: 16px;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }
    .items { font-size: 12px; }
    .kcal-col { flex: none; text-align: right; }
    .kcal { font-family: var(--font-heading); font-weight: 800; font-size: 17px; }
    .unit { font-size: 11px; }
    .chev { flex: none; opacity: 0.4; }
    .add {
      flex: none;
      width: 52px;
      border: 0;
      border-left: 1px solid var(--color-divider);
      background: var(--color-bg);
      cursor: pointer;
      color: var(--color-accent);
      display: grid;
      place-items: center;
      transition: background 0.15s ease;
    }
    .add:hover { background: var(--color-accent-100); }
  `,
})
export class MealCard {
  protected readonly i18n = inject(I18n);
  protected readonly round = round;

  readonly label = input.required<string>();
  readonly section = input.required<MealSection>();

  readonly open = output<void>();
  readonly add = output<void>();

  protected readonly itemsLabel = computed(() => {
    const count = this.section().entries.length;
    if (count === 0) return this.i18n.t('diary.nothingLogged');
    if (count === 1) return this.i18n.t('diary.oneItem');
    return this.i18n.t('diary.manyItems', { n: count });
  });
}
