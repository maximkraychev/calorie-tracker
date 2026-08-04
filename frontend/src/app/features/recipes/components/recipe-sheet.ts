import { Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { Field, form, FormField, max, maxLength, min, required } from '@angular/forms/signals';

import { I18n } from '../../../core/i18n/i18n';
import { Icon } from '../../../shared/ui/icon';
import { macrosOf, round, round1 } from '../../../shared/utils/nutrition.utils';
import { AddFoodOverlay } from '../../diary/components/add-food-overlay';
import {
  deriveNutrition,
  type NewRecipe,
  type NewRecipeIngredient,
  type Recipe,
  type RecipeMode,
} from '../models/recipe.models';

// A draft ingredient. Identical to a submitted one plus a local key: the list is edited by
// index-free `@for` tracking, and a brand-new ingredient has no server id to track by.
interface DraftIngredient extends NewRecipeIngredient {
  key: string;
}

// The form's own draft shape. Numbers are nullable because an emptied `type="number"`
// input has no value — modelling that as 0 would silently save a zero-calorie recipe.
interface RecipeDraft {
  name: string;
  totalWeightG: number | null;
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
}

// Full-screen sheet for creating or editing a recipe (z 50 — the same slot the custom-food
// sheet uses; the two never coexist, and the ingredient picker it opens sits above it at
// z 55). Full-screen rather than a bottom sheet because an ingredient list plus a live
// totals card needs the room.
//
// Presentational like the other sheets: the draft lives here and nothing is persisted
// until `save` or `delete` is emitted.
//
// Mode is deliberately a local signal rather than a form field. It is a structural switch
// — it decides which fields exist at all — and the two modes' validation rules are
// disjoint, so a single schema would have to make everything conditional.
@Component({
  selector: 'ct-recipe-sheet',
  imports: [FormField, Icon, AddFoodOverlay],
  template: `
    <div class="overlay">
      <header class="head">
        <div class="title">{{ i18n.t(recipe() ? 'recipes.editTitle' : 'recipes.newTitle') }}</div>
        <button
          class="btn btn-icon"
          type="button"
          [attr.aria-label]="i18n.t('account.close')"
          (click)="close.emit()"
        >
          <ct-icon name="x" />
        </button>
      </header>

      <div class="body">
        <form id="recipe-form" (submit)="submit($event)" novalidate>
          <div class="field">
            <label for="rc-name">{{ i18n.t('recipes.name') }}</label>
            <input
              id="rc-name"
              class="input"
              type="text"
              autocomplete="off"
              [placeholder]="i18n.t('recipes.namePlaceholder')"
              [formField]="recipeForm.name"
            />
            @if (showError(recipeForm.name)) {
              <p class="field-error">{{ firstError(recipeForm.name) }}</p>
            }
          </div>

          <label class="field-label">{{ i18n.t('recipes.mode') }}</label>
          <div class="mode-seg">
            <button
              class="seg"
              type="button"
              [class.active]="mode() === 'ingredients'"
              (click)="mode.set('ingredients')"
            >
              {{ i18n.t('recipes.modeIngredients') }}
            </button>
            <button
              class="seg"
              type="button"
              [class.active]="mode() === 'manual'"
              (click)="mode.set('manual')"
            >
              {{ i18n.t('recipes.modeManual') }}
            </button>
          </div>

          @if (mode() === 'manual') {
            <div class="section-label">{{ i18n.t('recipes.totals') }}</div>
            <div class="grid">
              <div class="field">
                <label for="rc-kcal">{{ i18n.t('myFoods.kcal') }}</label>
                <input
                  id="rc-kcal"
                  class="input num"
                  type="number"
                  inputmode="decimal"
                  [formField]="recipeForm.kcal"
                />
                @if (showError(recipeForm.kcal)) {
                  <p class="field-error">{{ firstError(recipeForm.kcal) }}</p>
                }
              </div>
              <div class="field">
                <label for="rc-protein">{{ i18n.t('diary.protein') }}</label>
                <input
                  id="rc-protein"
                  class="input num"
                  type="number"
                  inputmode="decimal"
                  [formField]="recipeForm.protein"
                />
                @if (showError(recipeForm.protein)) {
                  <p class="field-error">{{ firstError(recipeForm.protein) }}</p>
                }
              </div>
              <div class="field">
                <label for="rc-carbs">{{ i18n.t('diary.carbs') }}</label>
                <input
                  id="rc-carbs"
                  class="input num"
                  type="number"
                  inputmode="decimal"
                  [formField]="recipeForm.carbs"
                />
                @if (showError(recipeForm.carbs)) {
                  <p class="field-error">{{ firstError(recipeForm.carbs) }}</p>
                }
              </div>
              <div class="field">
                <label for="rc-fat">{{ i18n.t('diary.fat') }}</label>
                <input
                  id="rc-fat"
                  class="input num"
                  type="number"
                  inputmode="decimal"
                  [formField]="recipeForm.fat"
                />
                @if (showError(recipeForm.fat)) {
                  <p class="field-error">{{ firstError(recipeForm.fat) }}</p>
                }
              </div>
            </div>
          } @else {
            <div class="section-label">{{ i18n.t('recipes.ingredients') }}</div>

            @if (ingredients().length === 0) {
              <p class="text-muted hint no-ing">{{ i18n.t('recipes.noIngredients') }}</p>
            } @else {
              @for (ingredient of ingredients(); track ingredient.key) {
                <div class="ing">
                  <div class="ing-text">
                    <div class="ing-name">{{ ingredient.name }}</div>
                    <div class="text-muted ing-meta">{{ ingredientMeta(ingredient) }}</div>
                  </div>
                  <input
                    class="input num ing-grams"
                    type="number"
                    inputmode="decimal"
                    min="0"
                    [attr.aria-label]="i18n.t('recipes.ingredientGrams', { name: ingredient.name })"
                    [value]="ingredient.grams"
                    (input)="onGramsInput(ingredient.key, $event)"
                  />
                  <button
                    class="btn btn-icon"
                    type="button"
                    [attr.aria-label]="
                      i18n.t('recipes.removeIngredient', { name: ingredient.name })
                    "
                    (click)="removeIngredient(ingredient.key)"
                  >
                    <ct-icon name="x" [size]="16" />
                  </button>
                </div>
              }
            }

            <button class="btn btn-secondary add-ing" type="button" (click)="pickerOpen.set(true)">
              <ct-icon name="plus" [size]="18" />
              {{ i18n.t('recipes.addIngredient') }}
            </button>
          }

          <div class="field weight">
            <label for="rc-weight">
              {{
                i18n.t(mode() === 'manual' ? 'recipes.totalWeight' : 'recipes.totalWeightOptional')
              }}
            </label>
            <input
              id="rc-weight"
              class="input num"
              type="number"
              inputmode="decimal"
              [formField]="recipeForm.totalWeightG"
            />
            @if (showError(recipeForm.totalWeightG)) {
              <p class="field-error">{{ firstError(recipeForm.totalWeightG) }}</p>
            } @else if (mode() === 'ingredients') {
              <p class="text-muted hint">{{ i18n.t('recipes.totalWeightHint') }}</p>
            }
          </div>

          <!-- Live preview of what the recipe works out to. The per-100g figure is the one
               that matters: it is what a logged portion scales from. -->
          <div class="preview">
            <div class="preview-head">{{ i18n.t('recipes.totals') }}</div>
            <div class="preview-top">
              <span class="preview-kcal">{{ round(derived().totals.kcal) }}</span>
              <span class="preview-label">{{ i18n.t('diary.kcal') }}</span>
              <span class="text-muted preview-weight">{{ round(derived().totalWeightG) }} g</span>
            </div>
            <div class="preview-macros">
              <div>{{ i18n.t('diary.protein') }}&nbsp;{{ round1(derived().totals.protein) }} g</div>
              <div>{{ i18n.t('diary.carbs') }}&nbsp;{{ round1(derived().totals.carbs) }} g</div>
              <div>{{ i18n.t('diary.fat') }}&nbsp;{{ round1(derived().totals.fat) }} g</div>
            </div>
            <div class="text-muted preview-per100">
              {{ i18n.t('recipes.per100g') }}: {{ round(derived().per100g.kcalPer100g) }}
              {{ i18n.t('diary.kcal') }} · {{ round1(derived().per100g.proteinPer100g) }}/{{
                round1(derived().per100g.carbsPer100g)
              }}/{{ round1(derived().per100g.fatPer100g) }} g
            </div>
          </div>

          @if (submitted() && !hasIngredients()) {
            <p class="field-error">{{ i18n.t('recipes.noIngredients') }}</p>
          }
          @if (submitted() && outOfRange()) {
            <p class="field-error">{{ i18n.t('recipes.outOfRange') }}</p>
          }
        </form>

        @if (recipe()) {
          <button class="btn btn-ghost delete" type="button" (click)="delete.emit()">
            <ct-icon name="trash" />
            {{ i18n.t('recipes.delete') }}
          </button>
          <p class="text-muted hint delete-hint">{{ i18n.t('recipes.deleteHint') }}</p>
        }
      </div>

      <div class="foot">
        <button class="btn btn-primary save" type="submit" form="recipe-form">
          {{ i18n.t('recipes.save') }}
        </button>
      </div>

      @if (pickerOpen()) {
        <!-- The diary's Add-Food overlay, borrowed in 'pick' mode: same search, barcode
             scanner and My Foods pane, but it emits an ingredient instead of logging. -->
        <ct-add-food-overlay
          purpose="pick"
          (pickIngredient)="addIngredient($event)"
          (close)="pickerOpen.set(false)"
        />
      }
    </div>
  `,
  styles: `
    .overlay {
      position: absolute;
      inset: 0;
      z-index: 50;
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
    .head .btn-icon {
      border: 1px solid var(--color-divider);
    }
    .title {
      font-family: var(--font-heading);
      font-weight: 800;
      font-size: 16px;
      margin-right: auto;
    }

    .body {
      flex: 1;
      overflow-y: auto;
      padding: var(--space-4);
    }

    .field {
      margin-bottom: var(--space-3);
    }
    .field-label {
      display: block;
      font-size: 12px;
      margin-bottom: 6px;
      color: color-mix(in srgb, var(--color-text) 70%, transparent);
    }
    .section-label {
      font-family: var(--font-heading);
      font-weight: 800;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin: var(--space-4) 0 var(--space-2);
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

    .mode-seg {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1px;
      background: var(--color-divider);
      border: 1px solid var(--color-divider);
      border-radius: 12px;
      overflow: hidden;
      margin-bottom: var(--space-2);
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

    .ing {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-2) 0;
      border-bottom: 1px solid var(--color-divider);
    }
    .ing-text {
      flex: 1;
      min-width: 0;
    }
    .ing-name {
      font-weight: 600;
      font-size: 14px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .ing-meta {
      font-size: 12px;
    }
    .ing-grams {
      flex: none;
      width: 78px;
      padding: 6px 4px;
      font-size: 14px;
    }
    .ing .btn-icon {
      flex: none;
      border: 1px solid var(--color-divider);
    }
    .no-ing {
      padding: var(--space-3) 0;
    }
    .add-ing {
      width: 100%;
      justify-content: center;
      gap: 6px;
      margin-top: var(--space-3);
    }

    .preview {
      background: var(--color-surface);
      color: var(--color-text);
      border: 1px solid var(--color-divider);
      border-radius: 18px;
      padding: var(--space-4);
      margin-top: var(--space-5);
    }
    .preview-head {
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      opacity: 0.7;
      margin-bottom: var(--space-2);
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
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: var(--space-2);
      margin-top: var(--space-3);
      border-top: 1px solid var(--color-divider);
      padding-top: var(--space-3);
      font-size: 13px;
      opacity: 0.9;
    }
    .preview-per100 {
      margin-top: var(--space-2);
      font-size: 12px;
    }

    .delete {
      width: 100%;
      justify-content: center;
      margin-top: var(--space-5);
    }
    .delete-hint {
      text-align: center;
    }

    .foot {
      flex: none;
      padding: var(--space-3) var(--space-4);
      border-top: 2px solid var(--color-divider);
    }
    .save {
      width: 100%;
      justify-content: center;
      padding: var(--space-3);
    }
  `,
})
export class RecipeSheet {
  protected readonly i18n = inject(I18n);
  protected readonly round = round;
  protected readonly round1 = round1;

  /** The recipe being edited, or null when creating a new one. */
  readonly recipe = input<Recipe | null>(null);

  readonly close = output<void>();
  readonly save = output<NewRecipe>();
  readonly delete = output<void>();

  protected readonly submitted = signal(false);
  protected readonly pickerOpen = signal(false);

  // All three are seeded from the recipe being edited, and reseeded if a different one
  // opens. Plain `signal(...)` would not work: field initializers run before Angular
  // applies the input, so they would capture the null default and open blank.
  private readonly draft = linkedSignal(() => toDraft(this.recipe()));
  protected readonly mode = linkedSignal<RecipeMode>(() => this.recipe()?.mode ?? 'ingredients');
  protected readonly ingredients = linkedSignal(() => toDraftIngredients(this.recipe()));

  // Only the fields the active mode actually uses are validated. `min`/`max` on an empty
  // (null) field is a no-op, so the manual-only numbers stay valid while in ingredients
  // mode and `submit` never sees a spurious error from a hidden field.
  protected readonly recipeForm = form(this.draft, (path) => {
    required(path.name, { message: this.i18n.t('error.nameRequired') });
    maxLength(path.name, 200);

    for (const field of [path.kcal, path.protein, path.carbs, path.fat, path.totalWeightG]) {
      min(field, 0, { message: this.i18n.t('error.numberRequired') });
    }
    max(path.totalWeightG, 999999.99, { message: this.i18n.t('error.numberRequired') });
  });

  /** What the current draft works out to — the same math the server will run. */
  protected readonly derived = computed(() => deriveNutrition(this.toNewRecipe()));

  protected readonly hasIngredients = computed(
    () => this.mode() === 'manual' || this.ingredients().length > 0,
  );

  // The `log_entries` per-100g ranges, checked here so the save is not a round trip to a
  // 400. Almost always a total weight too small for the totals entered.
  protected readonly outOfRange = computed(() => {
    const { per100g } = this.derived();
    return (
      per100g.kcalPer100g > 900 ||
      per100g.proteinPer100g > 100 ||
      per100g.carbsPer100g > 100 ||
      per100g.fatPer100g > 100
    );
  });

  protected ingredientMeta(ingredient: DraftIngredient): string {
    const kcal = round(macrosOf(ingredient).kcal);
    const brand = ingredient.brand ? `${ingredient.brand} · ` : '';
    return `${brand}${kcal} ${this.i18n.t('diary.kcal')}`;
  }

  protected addIngredient(picked: NewRecipeIngredient): void {
    this.pickerOpen.set(false);
    this.ingredients.update((list) => [...list, { ...picked, key: crypto.randomUUID() }]);
  }

  protected removeIngredient(key: string): void {
    this.ingredients.update((list) => list.filter((ingredient) => ingredient.key !== key));
  }

  protected onGramsInput(key: string, event: Event): void {
    const value = Number.parseFloat((event.target as HTMLInputElement).value);
    const grams = Number.isFinite(value) && value >= 0 ? value : 0;
    this.ingredients.update((list) =>
      list.map((ingredient) => (ingredient.key === key ? { ...ingredient, grams } : ingredient)),
    );
  }

  protected submit(event: Event): void {
    event.preventDefault();
    this.submitted.set(true);
    if (this.recipeForm().invalid() || !this.hasIngredients() || this.outOfRange()) return;

    // Manual mode needs all four totals and a weight; the form cannot express "required
    // only in this mode", so it is checked here where the mode is known.
    const draft = this.draft();
    if (this.mode() === 'manual') {
      const missing =
        draft.totalWeightG === null ||
        draft.totalWeightG <= 0 ||
        draft.kcal === null ||
        draft.protein === null ||
        draft.carbs === null ||
        draft.fat === null;
      if (missing) return;
    }

    // A zero-gram ingredient means the user emptied the field rather than removing the
    // row; the API's positive-grams rule would reject it.
    if (this.mode() === 'ingredients' && this.ingredients().some((i) => i.grams <= 0)) return;

    this.save.emit(this.toNewRecipe());
  }

  // Show a field's error once the user has tried to submit or left the field.
  protected showError(field: Field<unknown>): boolean {
    const state = field();
    return (this.submitted() || state.touched()) && state.invalid();
  }

  protected firstError(field: Field<unknown>): string {
    return field().errors()[0]?.message ?? '';
  }

  // The draft as the API shape. Also drives the live preview, which is why it tolerates an
  // incomplete manual form (nulls read as 0) rather than asserting.
  private toNewRecipe(): NewRecipe {
    const draft = this.draft();
    const name = draft.name.trim();

    if (this.mode() === 'manual') {
      return {
        name,
        mode: 'manual',
        totalWeightG: draft.totalWeightG ?? 0,
        totals: {
          kcal: draft.kcal ?? 0,
          protein: draft.protein ?? 0,
          carbs: draft.carbs ?? 0,
          fat: draft.fat ?? 0,
        },
      };
    }

    return {
      name,
      mode: 'ingredients',
      totalWeightG: draft.totalWeightG,
      ingredients: this.ingredients().map(({ key: _key, ...ingredient }) => ingredient),
    };
  }
}

// An existing recipe seeds the draft; a new one starts blank rather than at 0, so the user
// types into empty fields instead of clearing zeros.
//
// `totalWeightG` is seeded only for manual recipes: in ingredients mode the stored value
// may be the computed sum rather than a deliberate override, and pre-filling it would turn
// every edit into a permanent override that stops tracking the ingredients.
function toDraft(recipe: Recipe | null): RecipeDraft {
  const manual = recipe?.mode === 'manual' ? recipe : null;
  return {
    name: recipe?.name ?? '',
    totalWeightG: manual?.totalWeightG ?? null,
    kcal: manual?.totals.kcal ?? null,
    protein: manual?.totals.protein ?? null,
    carbs: manual?.totals.carbs ?? null,
    fat: manual?.totals.fat ?? null,
  };
}

function toDraftIngredients(recipe: Recipe | null): DraftIngredient[] {
  return (recipe?.ingredients ?? []).map((ingredient) => ({
    name: ingredient.name,
    brand: ingredient.brand,
    source: ingredient.source,
    customFoodId: ingredient.customFoodId,
    externalId: ingredient.externalId,
    grams: ingredient.grams,
    kcalPer100g: ingredient.kcalPer100g,
    proteinPer100g: ingredient.proteinPer100g,
    carbsPer100g: ingredient.carbsPer100g,
    fatPer100g: ingredient.fatPer100g,
    // Server ids exist here, but ingredients are replaced wholesale on save, so the list
    // key only has to be stable within this editing session.
    key: crypto.randomUUID(),
  }));
}
