import { Component, computed, inject, output, signal } from '@angular/core';

import { GoalsStore, type Goals } from '../goals/goals.store';
import { I18n } from '../i18n/i18n';
import { type TranslationKey } from '../i18n/translations';
import { Icon } from '../../shared/ui/icon';

// The three tracked macros, with how many kcal one gram carries. This drives the
// grams <-> % conversion (protein/carbs = 4 kcal/g, fat = 9 kcal/g). Each macro carries
// its own color + tint token so its goal ring matches the diary macro bars.
type MacroKey = 'protein' | 'carbs' | 'fat';
interface MacroMeta {
  key: MacroKey;
  kcalPerG: number;
  labelKey: TranslationKey;
  color: string;
  text: string;
  track: string;
}
// Display order is carbs -> protein -> fat, matching the diary bars and every macro readout.
// `color` strokes the ring, `text` is the darker AA-safe tier for the label and percentage.
const MACROS: readonly MacroMeta[] = [
  { key: 'carbs', kcalPerG: 4, labelKey: 'goals.carbs', color: 'var(--macro-carbs)', text: 'var(--macro-carbs-text)', track: 'var(--macro-carbs-100)' },
  { key: 'protein', kcalPerG: 4, labelKey: 'goals.protein', color: 'var(--macro-protein)', text: 'var(--macro-protein-text)', track: 'var(--macro-protein-100)' },
  { key: 'fat', kcalPerG: 9, labelKey: 'goals.fat', color: 'var(--macro-fat)', text: 'var(--macro-fat-text)', track: 'var(--macro-fat-100)' },
];

// Goal-ring geometry (66x66 svg, radius 27, stroke 7) — matches the design prototype.
const GOAL_RING_RADIUS = 27;
const GOAL_RING_CIRC = 2 * Math.PI * GOAL_RING_RADIUS;

// A macro is edited through two linked drafts: grams and % of the calorie goal.
interface MacroDraft {
  g: string;
  pct: string;
}
interface Model {
  kcal: string;
  protein: MacroDraft;
  carbs: MacroDraft;
  fat: MacroDraft;
}

// Bottom sheet for the daily targets, opened from the account sheet. kcal is the master
// total; each macro can be set by grams OR by % of kcal, and editing one recomputes the
// other through the calorie total. Editing kcal keeps each macro's % and rescales grams.
// Saving persists grams via the GoalsStore, which drives the diary's ring and bars.
//
// Uses plain inputs (not Signal Forms) because the grams <-> % coupling is imperative:
// each handler writes only its sibling field, which keeps the two-way link loop-free.
@Component({
  selector: 'ct-goals-sheet',
  imports: [Icon],
  template: `
    <div class="scrim" (click)="close.emit()">
      <div class="sheet" (click)="$event.stopPropagation()">
        <div class="head">
          <h3>{{ i18n.t('goals.title') }}</h3>
          <button
            class="btn btn-icon"
            type="button"
            [attr.aria-label]="i18n.t('account.close')"
            (click)="close.emit()"
          >
            <ct-icon name="x" />
          </button>
        </div>

        <form (submit)="save($event)" novalidate>
          <div class="field kcal-field">
            <label for="goal-kcal">{{ i18n.t('goals.calorieGoal') }}</label>
            <input
              id="goal-kcal"
              class="input"
              type="number"
              inputmode="numeric"
              placeholder="2200"
              [value]="model().kcal"
              (input)="onKcal(value($event))"
            />
          </div>

          <div class="macros-head">
            <h4>{{ i18n.t('goals.macroGoals') }}</h4>
            <span class="macros-sum">{{ i18n.t('goals.macrosSum', { pct: totalPct() }) }}</span>
          </div>

          <div class="macro-cards">
            @for (macro of macros; track macro.key) {
              <div class="macro-card">
                <div class="ring">
                  <svg width="66" height="66" viewBox="0 0 66 66">
                    <circle cx="33" cy="33" r="27" fill="none" [style.stroke]="macro.track" stroke-width="7" />
                    <circle
                      cx="33"
                      cy="33"
                      r="27"
                      fill="none"
                      [style.stroke]="macro.color"
                      stroke-width="7"
                      stroke-linecap="round"
                      [attr.stroke-dasharray]="ringCirc"
                      [attr.stroke-dashoffset]="ringOffset(macro.key)"
                      transform="rotate(-90 33 33)"
                    />
                  </svg>
                  <span class="ring-pct" [style.color]="macro.text">{{ pctOf(macro.key) }}%</span>
                </div>

                <div class="macro-name" [style.color]="macro.text">{{ i18n.t(macro.labelKey) }}</div>

                <div class="macro-input">
                  <input
                    class="input"
                    [id]="'goal-' + macro.key + '-g'"
                    type="number"
                    inputmode="numeric"
                    [value]="model()[macro.key].g"
                    (input)="onGrams(macro, value($event))"
                    [attr.aria-label]="i18n.t(macro.labelKey) + ' ' + i18n.t('goals.colGrams')"
                  />
                  <span class="unit">g</span>
                </div>
                <div class="macro-input">
                  <input
                    class="input"
                    type="number"
                    inputmode="numeric"
                    [value]="model()[macro.key].pct"
                    (input)="onPct(macro, value($event))"
                    [attr.aria-label]="i18n.t(macro.labelKey) + ' ' + i18n.t('goals.colPercent')"
                  />
                  <span class="unit">%</span>
                </div>
              </div>
            }
          </div>

          <button class="btn btn-primary save" type="submit">{{ i18n.t('goals.save') }}</button>
        </form>
      </div>
    </div>
  `,
  styles: `
    .scrim {
      position: absolute;
      inset: 0;
      z-index: 65;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      background: color-mix(in srgb, var(--color-neutral-900) 45%, transparent);
    }
    .sheet {
      background: var(--color-bg);
      padding: var(--space-4) var(--space-4) var(--space-safe-bottom);
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
    .head h3 { margin: 0; font-size: 22px; }
    .head .btn-icon { border: 1px solid var(--color-divider); }

    .kcal-field { margin-bottom: var(--space-4); }
    .macros-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      border-top: 2px solid var(--color-divider);
      padding-top: var(--space-3);
      margin-bottom: var(--space-3);
    }
    .macros-head h4 {
      margin: 0;
      font-size: 14px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    .macros-sum { font-size: 12px; color: var(--color-text-muted); }

    .macro-cards {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: var(--space-2);
      margin-bottom: var(--space-6);
    }
    .macro-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 9px;
      background: var(--color-surface);
      border: 1px solid var(--color-divider);
      border-radius: 14px;
      padding: var(--space-3) 8px;
    }
    .ring { position: relative; width: 66px; height: 66px; }
    .ring svg { display: block; }
    .ring-pct {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: var(--font-heading);
      font-weight: 800;
      font-size: 15px;
    }
    .macro-name {
      font-size: 11px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      font-weight: 700;
    }
    .macro-input { display: flex; align-items: center; gap: 3px; width: 100%; }
    .macro-input .input { text-align: center; padding: 6px 2px; }
    .macro-input .unit { font-size: 12px; opacity: 0.55; }

    .save { width: 100%; justify-content: center; padding: var(--space-3); }
  `,
})
export class GoalsSheet {
  protected readonly i18n = inject(I18n);
  private readonly goalsStore = inject(GoalsStore);

  readonly close = output<void>();

  protected readonly macros = MACROS;
  protected readonly ringCirc = GOAL_RING_CIRC;

  // String drafts so clearing an input doesn't coerce to 0 mid-edit; parsed on save.
  protected readonly model = signal<Model>(this.fromGoals(this.goalsStore.goals()));

  // Live sum of the three macro percentages; 100 means they exactly fill the kcal goal.
  protected readonly totalPct = computed(() =>
    Math.round(MACROS.reduce((sum, macro) => sum + numberOr(this.model()[macro.key].pct, 0), 0)),
  );

  // Whole-number % for a macro's goal ring + center label (0 when the field is empty).
  protected pctOf(key: MacroKey): number {
    return Math.round(numberOr(this.model()[key].pct, 0));
  }

  // Ring sweep: the dashoffset shrinks toward 0 as the macro's % approaches 100.
  protected ringOffset(key: MacroKey): number {
    return GOAL_RING_CIRC * (1 - Math.min(1, this.pctOf(key) / 100));
  }

  // Extract the current value from an input event (typed target unwrap for the template).
  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  // Editing grams updates the matching % (needs a positive kcal goal to convert against).
  protected onGrams(macro: MacroMeta, grams: string): void {
    const kcal = parseFloat(this.model().kcal);
    const g = parseFloat(grams);
    const pct =
      Number.isFinite(g) && kcal > 0
        ? String(gramsToPct(g, macro.kcalPerG, kcal))
        : this.model()[macro.key].pct;
    this.setMacro(macro.key, { g: grams, pct });
  }

  // Editing % updates the matching grams.
  protected onPct(macro: MacroMeta, pct: string): void {
    const kcal = parseFloat(this.model().kcal);
    const p = parseFloat(pct);
    const g =
      Number.isFinite(p) && kcal > 0
        ? String(pctToGrams(p, macro.kcalPerG, kcal))
        : this.model()[macro.key].g;
    this.setMacro(macro.key, { g, pct });
  }

  // Changing the calorie goal keeps each macro's % and rescales its grams to match.
  protected onKcal(kcalStr: string): void {
    const kcal = parseFloat(kcalStr);
    this.model.update((m) => {
      const next: Model = { ...m, kcal: kcalStr };
      if (kcal > 0) {
        for (const macro of MACROS) {
          const p = parseFloat(next[macro.key].pct);
          if (Number.isFinite(p)) {
            next[macro.key] = { ...next[macro.key], g: String(pctToGrams(p, macro.kcalPerG, kcal)) };
          }
        }
      }
      return next;
    });
  }

  protected save(event: Event): void {
    event.preventDefault();
    const current = this.goalsStore.goals();
    const m = this.model();
    this.goalsStore.save({
      kcal: parseGoal(m.kcal, current.kcal),
      protein: parseGoal(m.protein.g, current.protein),
      carbs: parseGoal(m.carbs.g, current.carbs),
      fat: parseGoal(m.fat.g, current.fat),
    } satisfies Goals);
    this.close.emit();
  }

  // Seed both drafts of every macro from the stored gram goals.
  private fromGoals(goals: Goals): Model {
    const draft = (grams: number, kcalPerG: number): MacroDraft => ({
      g: String(grams),
      pct: goals.kcal > 0 ? String(gramsToPct(grams, kcalPerG, goals.kcal)) : '',
    });
    return {
      kcal: String(goals.kcal),
      protein: draft(goals.protein, 4),
      carbs: draft(goals.carbs, 4),
      fat: draft(goals.fat, 9),
    };
  }

  private setMacro(key: MacroKey, patch: Partial<MacroDraft>): void {
    this.model.update((m) => ({ ...m, [key]: { ...m[key], ...patch } }));
  }
}

// Grams -> share of the calorie goal, rounded to a whole percent for display.
function gramsToPct(grams: number, kcalPerG: number, kcal: number): number {
  return Math.round(((grams * kcalPerG) / kcal) * 100);
}

// Share of the calorie goal -> grams, rounded to a whole gram for display.
function pctToGrams(pct: number, kcalPerG: number, kcal: number): number {
  return Math.round(((pct / 100) * kcal) / kcalPerG);
}

function numberOr(value: string, fallback: number): number {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// An emptied or invalid field keeps its previous value instead of zeroing the goal.
function parseGoal(value: string, fallback: number): number {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
