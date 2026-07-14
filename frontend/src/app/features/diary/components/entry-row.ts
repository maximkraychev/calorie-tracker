import { Component, computed, inject, input, output } from '@angular/core';

import { I18n } from '../../../core/i18n/i18n';
import { macrosOf, round } from '../../../shared/utils/nutrition.utils';
import { Icon } from '../../../shared/ui/icon';
import type { LogEntry } from '../models/diary.models';

// One logged food, as a full-width tappable row. Presentational: it derives its own
// kcal/meta from the entry and emits `open` when tapped.
@Component({
  selector: 'ct-entry-row',
  imports: [Icon],
  template: `
    <button class="row" type="button" (click)="open.emit(entry().id)">
      <div class="info">
        <div class="name">{{ entry().name }}</div>
        <div class="text-muted meta">{{ meta() }}</div>
      </div>
      <div class="kcal-col">
        <div class="kcal">{{ kcal() }}</div>
        <div class="text-muted unit">{{ i18n.t('diary.kcal') }}</div>
      </div>
      <ct-icon name="chevron-right" class="chev" />
    </button>
  `,
  styles: `
    .row {
      display: flex;
      width: 100%;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-3) 0;
      text-align: left;
      border: 0;
      border-bottom: 1px solid var(--color-divider);
      background: transparent;
      color: inherit;
      font: inherit;
      cursor: pointer;
    }
    .info { flex: 1; min-width: 0; }
    .name {
      font-weight: 600;
      font-size: 15px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .meta { font-size: 12px; }
    .kcal-col { flex: none; text-align: right; }
    .kcal { font-family: var(--font-heading); font-weight: 800; font-size: 15px; }
    .unit { font-size: 11px; }
    .chev { flex: none; opacity: 0.4; }
  `,
})
export class EntryRow {
  protected readonly i18n = inject(I18n);

  readonly entry = input.required<LogEntry>();
  readonly open = output<string>();

  protected readonly kcal = computed(() => round(macrosOf(this.entry()).kcal));
  protected readonly meta = computed(() => {
    const entry = this.entry();
    const brand = entry.brand ? `${entry.brand} · ` : '';
    return `${brand}${entry.grams} g`;
  });
}
