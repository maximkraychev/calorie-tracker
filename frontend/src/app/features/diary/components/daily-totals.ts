import { Component, computed, inject, input } from '@angular/core';

import { I18n } from '../../../core/i18n/i18n';
import type { Goals } from '../../../core/goals/goals.store';
import { round, type Macros } from '../../../shared/utils/nutrition.utils';

// SVG ring geometry from the design spec: 210×210 viewBox, radius 93, stroke 14.
const RING_RADIUS = 93;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

// The diary's totals panel — a light surface card: a calorie progress ring (kcal left/over
// vs. the daily budget) over three macro progress bars. Purely presentational — totals and
// goals come in, fractions clamp to 100% for the visuals while the numbers may exceed the goal.
@Component({
  selector: 'ct-daily-totals',
  template: `
    <div class="panel">
      <div class="ring-wrap">
        <div class="ring">
          <svg width="210" height="210" viewBox="0 0 210 210">
            <circle cx="105" cy="105" r="93" fill="none" stroke="var(--color-neutral-100)" stroke-width="14" />
            <circle
              cx="105"
              cy="105"
              r="93"
              fill="none"
              stroke="var(--color-accent)"
              stroke-width="14"
              stroke-linecap="round"
              [attr.stroke-dasharray]="circumference"
              [attr.stroke-dashoffset]="ringOffset()"
              transform="rotate(-90 105 105)"
            />
          </svg>
          <div class="ring-center">
            <span class="ring-kcal">{{ kcalRemaining() }}</span>
            <span class="ring-label">{{ i18n.t(overBudget() ? 'diary.kcalOver' : 'diary.kcalLeft') }}</span>
            <span class="ring-budget">{{ i18n.t('diary.ofBudget', { kcal: goals().kcal }) }}</span>
          </div>
        </div>
      </div>

      <div class="macros">
        <div class="macro">
          <div class="macro-label">{{ i18n.t('diary.protein') }}</div>
          <div class="macro-value">
            {{ round(totals().protein) }}<span class="macro-goal"> / {{ goals().protein }} g</span>
          </div>
          <div class="bar"><div class="fill" [style.width.%]="barWidth(totals().protein, goals().protein)"></div></div>
        </div>
        <div class="macro">
          <div class="macro-label">{{ i18n.t('diary.carbs') }}</div>
          <div class="macro-value">
            {{ round(totals().carbs) }}<span class="macro-goal"> / {{ goals().carbs }} g</span>
          </div>
          <div class="bar"><div class="fill" [style.width.%]="barWidth(totals().carbs, goals().carbs)"></div></div>
        </div>
        <div class="macro">
          <div class="macro-label">{{ i18n.t('diary.fat') }}</div>
          <div class="macro-value">
            {{ round(totals().fat) }}<span class="macro-goal"> / {{ goals().fat }} g</span>
          </div>
          <div class="bar"><div class="fill" [style.width.%]="barWidth(totals().fat, goals().fat)"></div></div>
        </div>
      </div>
    </div>
  `,
  styles: `
    .panel {
      background: var(--color-surface);
      color: var(--color-text);
      border: 1px solid var(--color-divider);
      border-radius: 18px;
      padding: var(--space-6) var(--space-4) var(--space-4);
      margin-bottom: var(--space-6);
      box-shadow: var(--shadow-sm);
    }

    .ring-wrap { display: flex; justify-content: center; margin-bottom: var(--space-6); }
    .ring { position: relative; width: 210px; height: 210px; }
    .ring svg { display: block; }
    .ring-center {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 0 24px;
    }
    .ring-kcal {
      font-family: var(--font-heading);
      font-weight: 800;
      font-size: 52px;
      line-height: 0.85;
      letter-spacing: -0.02em;
    }
    .ring-label {
      font-size: 11px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      opacity: 0.7;
      margin-top: 8px;
    }
    .ring-budget { font-size: 12px; opacity: 0.5; margin-top: 3px; }

    .macros {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: var(--space-3);
      border-top: 1px solid var(--color-divider);
      padding-top: var(--space-3);
      padding-bottom: 12px;
    }
    .macro-label {
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      opacity: 0.6;
    }
    .macro-value { font-family: var(--font-heading); font-weight: 800; font-size: 20px; margin-top: 2px; }
    .macro-goal { font-size: 12px; opacity: 0.6; }
    .bar { height: 6px; background: var(--color-neutral-100); border-radius: 99px; margin-top: 8px; }
    .fill { height: 100%; background: var(--color-accent); border-radius: 99px; }
  `,
})
export class DailyTotals {
  protected readonly i18n = inject(I18n);
  protected readonly round = round;
  protected readonly circumference = RING_CIRCUMFERENCE;

  readonly totals = input.required<Macros>();
  readonly goals = input.required<Goals>();

  protected readonly overBudget = computed(() => this.totals().kcal > this.goals().kcal);
  protected readonly kcalRemaining = computed(() =>
    Math.abs(round(this.goals().kcal - this.totals().kcal)),
  );

  // dashoffset shrinks to 0 as consumption approaches the goal (fraction clamps at 1).
  protected readonly ringOffset = computed(() => {
    const goal = this.goals().kcal;
    const fraction = goal > 0 ? Math.min(1, this.totals().kcal / goal) : 0;
    return RING_CIRCUMFERENCE * (1 - fraction);
  });

  protected barWidth(consumed: number, goal: number): number {
    return goal > 0 ? Math.min(100, (consumed / goal) * 100) : 0;
  }
}
