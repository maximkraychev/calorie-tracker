import { Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import {
  Field,
  form,
  FormField,
  max,
  maxLength,
  min,
  required,
  validate,
} from '@angular/forms/signals';

import { I18n } from '../../../core/i18n/i18n';
import { Icon } from '../../../shared/ui/icon';
import { round, round1, type Per100g } from '../../../shared/utils/nutrition.utils';
import type { NewRecipeIngredient } from '../../recipes/models/recipe.models';
import {
  MEAL_LABEL_KEYS,
  MEAL_ORDER,
  type AddFoodPurpose,
  type LogEntry,
  type MealType,
} from '../models/diary.models';

// The form's own draft shape. Numbers are nullable because an emptied `type="number"`
// input has no value — modelling that as 0 would silently log a zero-calorie food.
interface ManualDraft {
  name: string;
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  /** The portion's weight. Optional — see `portionGrams` for what an empty one means. */
  grams: number | null;
}

// The per-100g ceilings the API enforces on `log_entries` (diary.schema.ts), checked here
// so a too-dense portion is an inline message rather than a round trip to a 400.
const MAX_KCAL_PER_100G = 900;
const MAX_MACRO_PER_100G = 100;

// numeric(7,2) tops out at 99999.99, and the API rejects anything larger.
const NUMERIC_7_2_MAX = 99999.99;

// A portion with no stated weight is stored against this many grams, which makes the
// typed totals double as the per-100g figures. See `portionGrams`.
const NOMINAL_GRAMS = 100;

/**
 * Manual entry — the Add-Food overlay's "type it in yourself" pane, for a food no catalog
 * has and that isn't worth saving to My Foods (a restaurant dish, a home-cooked meal).
 *
 * Unlike every other method it asks for the totals of the portion actually eaten rather
 * than per-100g values, because that is what someone reading a menu or a label has. It is
 * therefore self-contained: it carries its own meal switcher and log button instead of
 * handing a food to the overlay's shared portion step, which would ask for grams a second
 * time.
 *
 * Presentational: nothing is persisted here, and nothing is saved to My Foods — the draft
 * is emitted as one entry (or one recipe ingredient) and forgotten.
 */
@Component({
  selector: 'ct-manual-entry-pane',
  imports: [FormField, Icon],
  host: {
    // The overlay is a flex column; this pane owns the rest of it, splitting the space
    // into its own scrolling body and a pinned footer.
    style: 'flex: 1; display: flex; flex-direction: column; min-height: 0;',
  },
  template: `
    <div class="body">
      <form id="manual-form" (submit)="submit($event)" novalidate>
        <div class="field">
          <label for="mn-name">{{ i18n.t('myFoods.name') }}</label>
          <input
            id="mn-name"
            class="input"
            type="text"
            autocomplete="off"
            [placeholder]="i18n.t('addFood.manualNamePlaceholder')"
            [formField]="manualForm.name"
          />
          @if (showError(manualForm.name)) {
            <p class="field-error">{{ firstError(manualForm.name) }}</p>
          }
        </div>

        <div class="section-label">{{ i18n.t('addFood.manualTotals') }}</div>
        <div class="grid">
          <div class="field">
            <label for="mn-kcal">{{ i18n.t('myFoods.kcal') }}</label>
            <input
              id="mn-kcal"
              class="input num"
              type="number"
              inputmode="decimal"
              [formField]="manualForm.kcal"
            />
            @if (showError(manualForm.kcal)) {
              <p class="field-error">{{ firstError(manualForm.kcal) }}</p>
            }
          </div>
          <div class="field">
            <label for="mn-carbs">{{ i18n.t('diary.carbs') }}</label>
            <input
              id="mn-carbs"
              class="input num"
              type="number"
              inputmode="decimal"
              [formField]="manualForm.carbs"
            />
            @if (showError(manualForm.carbs)) {
              <p class="field-error">{{ firstError(manualForm.carbs) }}</p>
            }
          </div>
          <div class="field">
            <label for="mn-protein">{{ i18n.t('diary.protein') }}</label>
            <input
              id="mn-protein"
              class="input num"
              type="number"
              inputmode="decimal"
              [formField]="manualForm.protein"
            />
            @if (showError(manualForm.protein)) {
              <p class="field-error">{{ firstError(manualForm.protein) }}</p>
            }
          </div>
          <div class="field">
            <label for="mn-fat">{{ i18n.t('diary.fat') }}</label>
            <input
              id="mn-fat"
              class="input num"
              type="number"
              inputmode="decimal"
              [formField]="manualForm.fat"
            />
            @if (showError(manualForm.fat)) {
              <p class="field-error">{{ firstError(manualForm.fat) }}</p>
            }
          </div>
        </div>
        <p class="text-muted hint">{{ i18n.t('addFood.manualMacrosHint') }}</p>

        <div class="field weight">
          <label for="mn-weight">{{ i18n.t('addFood.manualWeight') }}</label>
          <input
            id="mn-weight"
            class="input num"
            type="number"
            inputmode="decimal"
            [formField]="manualForm.grams"
          />
          @if (showError(manualForm.grams)) {
            <p class="field-error">{{ firstError(manualForm.grams) }}</p>
          } @else {
            <p class="text-muted hint">{{ i18n.t('addFood.manualWeightHint') }}</p>
          }
        </div>

        @if (purpose() === 'log') {
          <label class="field-label">{{ i18n.t('addFood.meal') }}</label>
          <div class="meal-seg">
            @for (meal of mealOrder; track meal) {
              <button
                class="seg"
                type="button"
                [class.active]="targetMeal() === meal"
                (click)="targetMeal.set(meal)"
              >
                {{ i18n.t(mealLabelKeys[meal]) }}
              </button>
            }
          </div>
        }

        <!-- The totals restate what was typed; the per-100g line is the new information,
             and the one the entry is actually stored as. -->
        <div class="preview">
          <div class="preview-top">
            <span class="preview-kcal">{{ round(totals().kcal) }}</span>
            <span class="preview-label">{{ i18n.t('diary.kcal') }}</span>
            <span class="text-muted preview-weight">{{ round(portionGrams()) }} g</span>
          </div>
          <!-- The macro pills live here and nowhere else in this pane: the form above is
               already a dense grid of typed numbers, so the color belongs on the summary. -->
          <div class="preview-macros">
            <div class="macro-carbs macro-pill">
              {{ i18n.t('diary.carbs') }} {{ round1(totals().carbs) }} g
            </div>
            <div class="macro-protein macro-pill">
              {{ i18n.t('diary.protein') }} {{ round1(totals().protein) }} g
            </div>
            <div class="macro-fat macro-pill">
              {{ i18n.t('diary.fat') }} {{ round1(totals().fat) }} g
            </div>
          </div>
          <div class="text-muted preview-per100">
            {{ i18n.t('recipes.per100g') }}: {{ round(per100g().kcalPer100g) }}
            {{ i18n.t('diary.kcal') }} · {{ round1(per100g().carbsPer100g) }}/{{
              round1(per100g().proteinPer100g)
            }}/{{ round1(per100g().fatPer100g) }} g
          </div>
        </div>

        @if (outOfRange()) {
          <p class="field-error">
            {{ i18n.t('addFood.manualOutOfRange', { n: round(portionGrams()) }) }}
          </p>
        }
      </form>
    </div>

    <div class="foot">
      <button class="btn btn-primary confirm" type="submit" form="manual-form">
        <ct-icon name="check" />
        {{ i18n.t(purpose() === 'pick' ? 'recipes.addIngredient' : 'addFood.logFood') }}
      </button>
    </div>
  `,
  styles: `
    .body {
      flex: 1;
      overflow-y: auto;
      padding: var(--space-4);
    }

    .section-label {
      font-family: var(--font-heading);
      font-weight: 800;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin: var(--space-4) 0 var(--space-2);
    }
    .field {
      margin-bottom: var(--space-3);
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--space-3);
    }
    .num {
      text-align: center;
      font-family: var(--font-heading);
      font-weight: 800;
    }
    .hint {
      font-size: 12px;
      margin-top: 4px;
    }
    .weight {
      margin-top: var(--space-4);
    }

    .field-label {
      display: block;
      font-size: 12px;
      margin-bottom: 6px;
      color: color-mix(in srgb, var(--color-text) 70%, transparent);
    }
    .meal-seg {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 1px;
      background: var(--color-divider);
      border: 1px solid var(--color-divider);
      border-radius: 12px;
      overflow: hidden;
      margin-bottom: var(--space-4);
    }
    .seg {
      padding: 10px 4px;
      font-size: 12px;
      border: 0;
      cursor: pointer;
      font-family: var(--font-heading);
      font-weight: 800;
      background: var(--color-bg);
      color: var(--color-text);
    }
    .seg.active {
      background: var(--color-accent);
      color: var(--color-bg);
    }

    .preview {
      background: var(--color-surface);
      color: var(--color-text);
      border: 1px solid var(--color-divider);
      border-radius: 18px;
      padding: var(--space-4);
      margin-top: var(--space-4);
    }
    .preview-top {
      display: flex;
      align-items: baseline;
      gap: var(--space-2);
    }
    .preview-kcal {
      font-family: var(--font-heading);
      font-weight: 800;
      font-size: 38px;
      line-height: 1;
    }
    .preview-label {
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      opacity: 0.7;
    }
    .preview-weight {
      margin-left: auto;
      font-size: 13px;
    }
    .preview-macros {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      margin-top: var(--space-3);
      border-top: 1px solid var(--color-divider);
      padding-top: var(--space-3);
      font-size: 13px;
    }
    .preview-per100 {
      margin-top: var(--space-2);
      font-size: 12px;
    }

    .foot {
      flex: none;
      padding: var(--space-3) var(--space-4) var(--space-safe-bottom);
      border-top: 2px solid var(--color-divider);
    }
    .confirm {
      width: 100%;
      justify-content: center;
      padding: var(--space-3);
    }
  `,
})
export class ManualEntryPane {
  protected readonly i18n = inject(I18n);
  protected readonly round = round;
  protected readonly round1 = round1;
  protected readonly mealOrder = MEAL_ORDER;
  protected readonly mealLabelKeys = MEAL_LABEL_KEYS;

  /** Log a diary entry, or pick an ingredient for a recipe. */
  readonly purpose = input<AddFoodPurpose>('log');

  /** The meal the overlay was opened from. Null in 'pick' mode, where none is in play. */
  readonly meal = input<MealType | null>(null);

  readonly log = output<Omit<LogEntry, 'id'>>();
  readonly pickIngredient = output<NewRecipeIngredient>();

  protected readonly submitted = signal(false);

  private readonly draft = signal<ManualDraft>({
    name: '',
    kcal: null,
    protein: null,
    carbs: null,
    fat: null,
    grams: null,
  });

  // Falls back to the first meal only in 'pick' mode, where no meal is supplied and the
  // switcher is hidden — nothing downstream reads it there.
  protected readonly targetMeal = linkedSignal<MealType>(() => this.meal() ?? MEAL_ORDER[0]!);

  // Only the name and calories are required: someone quick-adding a restaurant dish often
  // knows the calorie count and nothing else, and an omitted macro is a truthful 0 rather
  // than a guess. The weight is optional too, but a supplied one has to be a real portion —
  // `min` alone would not say that, since it treats an empty field as nothing to check.
  protected readonly manualForm = form(this.draft, (path) => {
    required(path.name, { message: this.i18n.t('error.nameRequired') });
    maxLength(path.name, 200);

    required(path.kcal, { message: this.i18n.t('error.numberRequired') });

    for (const field of [path.kcal, path.protein, path.carbs, path.fat, path.grams]) {
      min(field, 0, { message: this.i18n.t('error.numberRequired') });
      max(field, NUMERIC_7_2_MAX, { message: this.i18n.t('error.numberRequired') });
    }

    validate(path.grams, ({ value }) => {
      const grams = value();
      return grams !== null && grams <= 0
        ? { kind: 'servingPositive', message: this.i18n.t('error.servingPositive') }
        : null;
    });
  });

  /**
   * The weight the entry is stored against.
   *
   * An entry is always per-100g values × grams, so a portion with no stated weight still
   * needs one. 100 g is the honest choice: it makes the typed totals the per-100g figures
   * unchanged, so the entry adds up to exactly what the user entered. The cost is a row
   * that reads "100 g" for a portion nobody weighed — which is why the field is offered.
   */
  protected readonly portionGrams = computed(() => this.draft().grams ?? NOMINAL_GRAMS);

  /** What was typed, with omitted macros read as 0. */
  protected readonly totals = computed(() => {
    const draft = this.draft();
    return {
      kcal: draft.kcal ?? 0,
      protein: draft.protein ?? 0,
      carbs: draft.carbs ?? 0,
      fat: draft.fat ?? 0,
    };
  });

  /** The totals scaled to 100 g — the shape everything downstream stores and renders. */
  protected readonly per100g = computed<Per100g>(() => {
    const grams = this.portionGrams();
    const totals = this.totals();
    // Guarded because the weight field accepts a 0 while the user is typing; the form
    // rejects it on submit, so this only keeps the live preview from showing Infinity.
    const factor = grams > 0 ? 100 / grams : 0;
    return {
      kcalPer100g: totals.kcal * factor,
      proteinPer100g: totals.protein * factor,
      carbsPer100g: totals.carbs * factor,
      fatPer100g: totals.fat * factor,
    };
  });

  // Almost always a portion weight too small for the totals entered — or none at all, for
  // a single item over 900 kcal. Either way the fix is the same: state the real weight.
  protected readonly outOfRange = computed(() => {
    const per100g = this.per100g();
    return (
      per100g.kcalPer100g > MAX_KCAL_PER_100G ||
      per100g.proteinPer100g > MAX_MACRO_PER_100G ||
      per100g.carbsPer100g > MAX_MACRO_PER_100G ||
      per100g.fatPer100g > MAX_MACRO_PER_100G
    );
  });

  protected submit(event: Event): void {
    event.preventDefault();
    this.submitted.set(true);
    if (this.manualForm().invalid() || this.outOfRange()) return;

    const name = this.draft().name.trim();
    const grams = this.portionGrams();
    const per100g = this.per100g();

    // Typed in by hand, so there is no catalog record to point at: no external id, no
    // custom food, no recipe. `source: 'manual'` is the entry's whole provenance.
    if (this.purpose() === 'pick') {
      this.pickIngredient.emit({
        name,
        brand: null,
        source: 'manual',
        customFoodId: null,
        externalId: null,
        grams,
        ...per100g,
      });
      return;
    }

    this.log.emit({
      mealType: this.targetMeal(),
      name,
      brand: null,
      source: 'manual',
      externalId: null,
      customFoodId: null,
      recipeId: null,
      grams,
      ...per100g,
    });
  }

  // Show a field's error once the user has tried to submit or left the field.
  protected showError(field: Field<unknown>): boolean {
    const state = field();
    return (this.submitted() || state.touched()) && state.invalid();
  }

  protected firstError(field: Field<unknown>): string {
    return field().errors()[0]?.message ?? '';
  }
}
