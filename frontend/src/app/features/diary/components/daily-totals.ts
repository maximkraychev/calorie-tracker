import { Component, computed, inject, input } from '@angular/core';

import { I18n } from '../../../core/i18n/i18n';
import type { Goals } from '../../../core/goals/goals.models';
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
          <svg width="100%" height="100%" viewBox="0 0 210 210">
            <defs>
              <linearGradient id="ctRingGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="#112D4E" />
                <stop offset="0.55" stop-color="#3F72AF" />
                <stop offset="1" stop-color="#7ba3d4" />
              </linearGradient>
            </defs>
            <circle cx="105" cy="105" r="93" fill="none" stroke="var(--color-neutral-100)" stroke-width="14" />
            <circle
              cx="105"
              cy="105"
              r="93"
              fill="none"
              stroke="url(#ctRingGrad)"
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
        @for (m of macroRows(); track m.key) {
          <div class="macro">
            <div class="macro-label">
              <span class="dot" [style.background]="m.color"></span>
              <span [style.color]="m.text">{{ m.label }}</span>
            </div>
            <div class="macro-value">
              {{ round(m.value) }}<span class="macro-goal"> / {{ m.goal }} g</span>
            </div>
            <div class="bar" [style.background]="m.track">
              <div class="fill" [style.background]="m.color" [style.width.%]="barWidth(m.value, m.goal)"></div>
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: `
    .panel {
      /* The dial is sized off the viewport height rather than the spec's flat 210px: on a
         ~6.3-inch phone that lands near 157px, which is what lets the fourth meal card
         clear the tab bar without scrolling. Tall screens still get the full 210. */
      --ring-size: clamp(140px, 18vh, 210px);

      background: var(--color-surface);
      color: var(--color-text);
      border: 1px solid var(--color-divider);
      border-radius: 18px;
      padding: var(--space-4) var(--space-4) var(--space-3);
      margin-bottom: var(--space-4);
      box-shadow: var(--shadow-sm);
    }

    .ring-wrap { display: flex; justify-content: center; margin-bottom: var(--space-3); }
    .ring { position: relative; width: var(--ring-size); height: var(--ring-size); }
    /* The SVG keeps its 210 viewBox and just scales to the box, so the ring geometry
       (r 93, stroke 14) and the dash maths below are untouched. */
    .ring svg { display: block; width: 100%; height: 100%; }

    /* The dial's text scales with it — each fraction below is the spec's 210px value
       divided by 210, so the whole thing shrinks as one unit. The two small labels get a
       px floor; proportional alone would drop them under 8px on a short screen. */
    .ring-center {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 0 calc(var(--ring-size) * 0.1);
    }
    .ring-kcal {
      font-family: var(--font-heading);
      font-weight: 800;
      font-size: calc(var(--ring-size) * 0.248);
      line-height: 0.85;
      letter-spacing: -0.02em;
    }
    .ring-label {
      font-size: max(9.5px, calc(var(--ring-size) * 0.052));
      letter-spacing: 0.12em;
      text-transform: uppercase;
      opacity: 0.7;
      margin-top: calc(var(--ring-size) * 0.038);
    }
    .ring-budget {
      font-size: max(10px, calc(var(--ring-size) * 0.057));
      opacity: 0.5;
      margin-top: calc(var(--ring-size) * 0.014);
    }

    .macros {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: var(--space-3);
      border-top: 1px solid var(--color-divider);
      padding-top: var(--space-3);
    }
    .macro-label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      font-weight: 700;
    }
    .macro-label .dot { width: 8px; height: 8px; border-radius: 99px; flex: none; }
    .macro-value { font-family: var(--font-heading); font-weight: 800; font-size: 20px; margin-top: 2px; }
    .macro-goal { font-size: 12px; opacity: 0.6; }
    .bar { height: 6px; border-radius: 99px; margin-top: 8px; overflow: hidden; }
    .fill { height: 100%; border-radius: 99px; }
  `,
})
export class DailyTotals {
  protected readonly i18n = inject(I18n);
  protected readonly round = round;
  protected readonly circumference = RING_CIRCUMFERENCE;

  readonly totals = input.required<Macros>();
  readonly goals = input.required<Goals>();

  // Per-macro display rows in carbs -> protein -> fat order, each with its own color +
  // tint token (amber/indigo/rose). `color` paints the dot and bar fill; `text` is the
  // darker AA-safe tier the label uses (the solid tokens are too light to read as text).
  // Labels go through i18n.t(), so the computed re-runs on a language switch.
  protected readonly macroRows = computed(() => [
    {
      key: 'carbs',
      label: this.i18n.t('diary.carbs'),
      color: 'var(--macro-carbs)',
      text: 'var(--macro-carbs-text)',
      track: 'var(--macro-carbs-100)',
      value: this.totals().carbs,
      goal: this.goals().carbs,
    },
    {
      key: 'protein',
      label: this.i18n.t('diary.protein'),
      color: 'var(--macro-protein)',
      text: 'var(--macro-protein-text)',
      track: 'var(--macro-protein-100)',
      value: this.totals().protein,
      goal: this.goals().protein,
    },
    {
      key: 'fat',
      label: this.i18n.t('diary.fat'),
      color: 'var(--macro-fat)',
      text: 'var(--macro-fat-text)',
      track: 'var(--macro-fat-100)',
      value: this.totals().fat,
      goal: this.goals().fat,
    },
  ]);

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
