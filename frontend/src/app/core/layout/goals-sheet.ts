import { Component, inject, output, signal } from '@angular/core';
import { form, FormField } from '@angular/forms/signals';

import { GoalsStore, type Goals } from '../goals/goals.store';
import { I18n } from '../i18n/i18n';
import { Icon } from '../../shared/ui/icon';

// Bottom sheet for the four daily targets (kcal + macro grams), opened from the account
// sheet. Edits a string draft of the current goals; saving parses and persists via the
// GoalsStore, which immediately drives the diary's ring and bars.
@Component({
  selector: 'ct-goals-sheet',
  imports: [FormField, Icon],
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
              [formField]="goalsForm.kcal"
            />
          </div>

          <div class="macros-head">
            <h4>{{ i18n.t('goals.macroGoals') }}</h4>
          </div>
          <div class="macros-grid">
            <div class="field">
              <label for="goal-protein">{{ i18n.t('goals.proteinG') }}</label>
              <input
                id="goal-protein"
                class="input"
                type="number"
                inputmode="numeric"
                [formField]="goalsForm.protein"
              />
            </div>
            <div class="field">
              <label for="goal-carbs">{{ i18n.t('goals.carbsG') }}</label>
              <input
                id="goal-carbs"
                class="input"
                type="number"
                inputmode="numeric"
                [formField]="goalsForm.carbs"
              />
            </div>
            <div class="field">
              <label for="goal-fat">{{ i18n.t('goals.fatG') }}</label>
              <input
                id="goal-fat"
                class="input"
                type="number"
                inputmode="numeric"
                [formField]="goalsForm.fat"
              />
            </div>
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
    .head h3 { margin: 0; font-size: 22px; }
    .head .btn-icon { border: 1px solid var(--color-divider); }

    .kcal-field { margin-bottom: var(--space-4); }
    .macros-head {
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
    .macros-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: var(--space-2);
      margin-bottom: var(--space-6);
    }
    .save { width: 100%; justify-content: center; padding: var(--space-3); }
  `,
})
export class GoalsSheet {
  protected readonly i18n = inject(I18n);
  private readonly goalsStore = inject(GoalsStore);

  readonly close = output<void>();

  // String draft so cleared inputs don't coerce to 0 mid-edit; parsed on save.
  private readonly model = signal({
    kcal: String(this.goalsStore.goals().kcal),
    protein: String(this.goalsStore.goals().protein),
    carbs: String(this.goalsStore.goals().carbs),
    fat: String(this.goalsStore.goals().fat),
  });
  protected readonly goalsForm = form(this.model);

  protected save(event: Event): void {
    event.preventDefault();
    const current = this.goalsStore.goals();
    const draft = this.model();
    this.goalsStore.save({
      kcal: parseGoal(draft.kcal, current.kcal),
      protein: parseGoal(draft.protein, current.protein),
      carbs: parseGoal(draft.carbs, current.carbs),
      fat: parseGoal(draft.fat, current.fat),
    } satisfies Goals);
    this.close.emit();
  }
}

// An emptied or invalid field keeps its previous value instead of zeroing the goal.
function parseGoal(value: string, fallback: number): number {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
