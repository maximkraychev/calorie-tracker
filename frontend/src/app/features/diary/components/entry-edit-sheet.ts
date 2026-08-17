import { Component, computed, inject, input, linkedSignal, output } from '@angular/core';

import { I18n } from '../../../core/i18n/i18n';
import { macrosOf, round, round1 } from '../../../shared/utils/nutrition.utils';
import { Icon } from '../../../shared/ui/icon';
import type { LogEntry } from '../models/diary.models';

// Bottom sheet for editing a logged entry's portion. The grams draft lives here (reset
// whenever a different entry opens) and the kcal/C/P/F preview recomputes live; nothing
// touches the diary until Save/Delete is emitted.
@Component({
  selector: 'ct-entry-edit-sheet',
  imports: [Icon],
  template: `
    <div class="scrim" (click)="close.emit()">
      <div class="sheet" (click)="$event.stopPropagation()">
        <div class="head">
          <div>
            <div class="name">{{ entry().name }}</div>
            <div class="text-muted meta">{{ meta() }}</div>
          </div>
          <button
            class="btn btn-icon"
            type="button"
            [attr.aria-label]="i18n.t('account.close')"
            (click)="close.emit()"
          >
            <ct-icon name="x" />
          </button>
        </div>

        <label class="grams-label" for="entry-grams">{{ i18n.t('entry.portionGrams') }}</label>
        <div class="stepper">
          <button
            class="btn btn-secondary step"
            type="button"
            [attr.aria-label]="i18n.t('entry.decreaseGrams')"
            (click)="addGrams(-10)"
          >
            −
          </button>
          <input
            id="entry-grams"
            class="input grams"
            type="number"
            inputmode="numeric"
            min="0"
            [value]="grams()"
            (input)="onGramsInput($event)"
          />
          <button
            class="btn btn-secondary step"
            type="button"
            [attr.aria-label]="i18n.t('entry.increaseGrams')"
            (click)="addGrams(10)"
          >
            +
          </button>
        </div>

        <div class="preview">
          <div class="cell">
            <div class="text-muted cell-label">{{ i18n.t('diary.kcal') }}</div>
            <div class="cell-value big">{{ round(preview().kcal) }}</div>
          </div>
          <div class="cell">
            <div class="text-muted cell-label">{{ i18n.t('macro.c') }}</div>
            <div class="cell-value">{{ round1(preview().carbs) }}</div>
          </div>
          <div class="cell">
            <div class="text-muted cell-label">{{ i18n.t('macro.p') }}</div>
            <div class="cell-value">{{ round1(preview().protein) }}</div>
          </div>
          <div class="cell">
            <div class="text-muted cell-label">{{ i18n.t('macro.f') }}</div>
            <div class="cell-value">{{ round1(preview().fat) }}</div>
          </div>
        </div>

        <button class="btn btn-primary save" type="button" (click)="save.emit(grams())">
          {{ i18n.t('entry.saveChanges') }}
        </button>
        <button class="btn btn-ghost delete" type="button" (click)="delete.emit()">
          <ct-icon name="trash" />
          {{ i18n.t('entry.deleteEntry') }}
        </button>
      </div>
    </div>
  `,
  styles: `
    .scrim {
      position: absolute;
      inset: 0;
      z-index: 45;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      background: color-mix(in srgb, var(--color-neutral-900) 45%, transparent);
    }
    .sheet {
      background: var(--color-bg);
      padding: var(--space-4);
      border-top: 2px solid var(--color-accent);
      border-radius: 22px 22px 0 0;
      animation: ct-sheet 0.22s ease;
    }
    .head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      margin-bottom: var(--space-4);
    }
    .head .btn-icon { border: 1px solid var(--color-divider); }
    .name { font-family: var(--font-heading); font-weight: 800; font-size: 18px; }
    .meta { font-size: 12px; }

    .grams-label {
      display: block;
      font-size: 12px;
      margin-bottom: 6px;
      color: color-mix(in srgb, var(--color-text) 70%, transparent);
    }
    .stepper {
      display: flex;
      align-items: stretch;
      gap: var(--space-2);
      margin-bottom: var(--space-4);
    }
    .step { width: 44px; }
    .grams {
      text-align: center;
      font-family: var(--font-heading);
      font-weight: 800;
      font-size: 18px;
    }

    .preview {
      display: grid;
      grid-template-columns: 1.4fr 1fr 1fr 1fr;
      gap: 1px;
      background: var(--color-divider);
      border: 1px solid var(--color-divider);
      border-radius: 12px;
      overflow: hidden;
      margin-bottom: var(--space-4);
    }
    .cell { background: var(--color-surface); padding: var(--space-2); }
    .cell-label { font-size: 10px; text-transform: uppercase; }
    .cell-value { font-family: var(--font-heading); font-weight: 800; font-size: 15px; }
    .cell-value.big { font-size: 17px; }

    .save { width: 100%; justify-content: center; padding: var(--space-3); margin-bottom: var(--space-2); }
    .delete { width: 100%; justify-content: center; }
  `,
})
export class EntryEditSheet {
  protected readonly i18n = inject(I18n);
  protected readonly round = round;
  protected readonly round1 = round1;

  readonly entry = input.required<LogEntry>();

  readonly close = output<void>();
  readonly save = output<number>();
  readonly delete = output<void>();

  // Draft grams: starts from the entry, resets if a different entry opens.
  protected readonly grams = linkedSignal(() => this.entry().grams);

  protected readonly meta = computed(() => {
    const entry = this.entry();
    const brand = entry.brand ? `${entry.brand} · ` : '';
    return `${brand}${round(entry.kcalPer100g)} ${this.i18n.t('entry.kcalPer100')}`;
  });

  protected readonly preview = computed(() => macrosOf({ ...this.entry(), grams: this.grams() }));

  protected addGrams(delta: number): void {
    this.grams.update((grams) => Math.max(0, grams + delta));
  }

  protected onGramsInput(event: Event): void {
    const value = parseFloat((event.target as HTMLInputElement).value);
    this.grams.set(Number.isFinite(value) && value >= 0 ? value : 0);
  }
}
