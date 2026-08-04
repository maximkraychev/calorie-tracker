import { Component, inject, input, linkedSignal, output, signal } from '@angular/core';
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
import type { CustomFood, NewCustomFood } from '../models/custom-food.models';

// The form's own draft shape. Numbers are nullable because an emptied `type="number"`
// input has no value — modelling that as 0 would silently save a zero-calorie food.
interface FoodDraft {
  name: string;
  brand: string;
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  servingSizeG: number | null;
}

// Bottom sheet for creating or editing a custom food (z 50 — between the entry-edit sheet
// and the Add-Food overlay; it never coexists with either, but the ladder stays readable).
//
// Presentational like the diary sheets: the draft lives here, nothing is persisted until
// `save` or `delete` is emitted. The parent instantiates it fresh per open, so the draft
// can be seeded from `food()` in the field initializer with no reset logic.
//
// The validation ranges mirror the CHECK constraints on `custom_foods` (and the Zod
// schema in front of them), so the server's 400 is unreachable through this form.
@Component({
  selector: 'ct-custom-food-sheet',
  imports: [FormField, Icon],
  template: `
    <div class="scrim" (click)="close.emit()">
      <div
        class="sheet"
        role="dialog"
        aria-modal="true"
        [attr.aria-label]="i18n.t(food() ? 'myFoods.editTitle' : 'myFoods.newTitle')"
        (click)="$event.stopPropagation()"
      >
        <div class="head">
          <div class="title">{{ i18n.t(food() ? 'myFoods.editTitle' : 'myFoods.newTitle') }}</div>
          <button
            class="btn btn-icon"
            type="button"
            [attr.aria-label]="i18n.t('account.close')"
            (click)="close.emit()"
          >
            <ct-icon name="x" />
          </button>
        </div>

        <form (submit)="submit($event)" novalidate>
          <div class="field">
            <label for="cf-name">{{ i18n.t('myFoods.name') }}</label>
            <input
              id="cf-name"
              class="input"
              type="text"
              autocomplete="off"
              [placeholder]="i18n.t('myFoods.namePlaceholder')"
              [formField]="foodForm.name"
            />
            @if (showError(foodForm.name)) {
              <p class="field-error">{{ firstError(foodForm.name) }}</p>
            }
          </div>

          <div class="field">
            <label for="cf-brand">{{ i18n.t('myFoods.brand') }}</label>
            <input
              id="cf-brand"
              class="input"
              type="text"
              autocomplete="off"
              [placeholder]="i18n.t('myFoods.brandPlaceholder')"
              [formField]="foodForm.brand"
            />
          </div>

          <div class="section-label">{{ i18n.t('myFoods.per100g') }}</div>
          <div class="grid">
            <div class="field">
              <label for="cf-kcal">{{ i18n.t('myFoods.kcal') }}</label>
              <input
                id="cf-kcal"
                class="input num"
                type="number"
                inputmode="decimal"
                [formField]="foodForm.kcal"
              />
              @if (showError(foodForm.kcal)) {
                <p class="field-error">{{ firstError(foodForm.kcal) }}</p>
              }
            </div>
            <div class="field">
              <label for="cf-protein">{{ i18n.t('diary.protein') }}</label>
              <input
                id="cf-protein"
                class="input num"
                type="number"
                inputmode="decimal"
                [formField]="foodForm.protein"
              />
              @if (showError(foodForm.protein)) {
                <p class="field-error">{{ firstError(foodForm.protein) }}</p>
              }
            </div>
            <div class="field">
              <label for="cf-carbs">{{ i18n.t('diary.carbs') }}</label>
              <input
                id="cf-carbs"
                class="input num"
                type="number"
                inputmode="decimal"
                [formField]="foodForm.carbs"
              />
              @if (showError(foodForm.carbs)) {
                <p class="field-error">{{ firstError(foodForm.carbs) }}</p>
              }
            </div>
            <div class="field">
              <label for="cf-fat">{{ i18n.t('diary.fat') }}</label>
              <input
                id="cf-fat"
                class="input num"
                type="number"
                inputmode="decimal"
                [formField]="foodForm.fat"
              />
              @if (showError(foodForm.fat)) {
                <p class="field-error">{{ firstError(foodForm.fat) }}</p>
              }
            </div>
          </div>

          <div class="field">
            <label for="cf-serving">{{ i18n.t('myFoods.servingSize') }}</label>
            <input
              id="cf-serving"
              class="input num"
              type="number"
              inputmode="decimal"
              [formField]="foodForm.servingSizeG"
            />
            @if (showError(foodForm.servingSizeG)) {
              <p class="field-error">{{ firstError(foodForm.servingSizeG) }}</p>
            } @else {
              <p class="text-muted hint">{{ i18n.t('myFoods.servingHint') }}</p>
            }
          </div>

          <button class="btn btn-primary save" type="submit">
            {{ i18n.t('myFoods.save') }}
          </button>
        </form>

        @if (food()) {
          <button class="btn btn-ghost delete" type="button" (click)="delete.emit()">
            <ct-icon name="trash" />
            {{ i18n.t('myFoods.delete') }}
          </button>
          <p class="text-muted hint delete-hint">{{ i18n.t('myFoods.deleteHint') }}</p>
        }
      </div>
    </div>
  `,
  styles: `
    .scrim {
      position: absolute;
      inset: 0;
      z-index: 50;
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
      max-height: 92%;
      overflow-y: auto;
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: var(--space-4);
    }
    .head .btn-icon { border: 1px solid var(--color-divider); }
    .title { font-family: var(--font-heading); font-weight: 800; font-size: 18px; }

    .field { margin-bottom: var(--space-3); }
    .section-label {
      font-family: var(--font-heading);
      font-weight: 800;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin: var(--space-4) 0 var(--space-2);
    }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); }
    .num { text-align: center; font-family: var(--font-heading); font-weight: 800; }
    .hint { font-size: 12px; margin-top: 4px; }

    .save {
      width: 100%;
      justify-content: center;
      padding: var(--space-3);
      margin-top: var(--space-4);
    }
    .delete { width: 100%; justify-content: center; margin-top: var(--space-2); }
    .delete-hint { text-align: center; }
  `,
})
export class CustomFoodSheet {
  protected readonly i18n = inject(I18n);

  /** The food being edited, or null when creating a new one. */
  readonly food = input<CustomFood | null>(null);

  readonly close = output<void>();
  readonly save = output<NewCustomFood>();
  readonly delete = output<void>();

  private readonly submitted = signal(false);

  // Seeded from the food being edited, and reseeded if a different one opens. A plain
  // `signal(toDraft(this.food()))` would not work: field initializers run before Angular
  // applies the input, so it would always capture the null default and open blank.
  private readonly draft = linkedSignal(() => toDraft(this.food()));

  protected readonly foodForm = form(this.draft, (path) => {
    required(path.name, { message: this.i18n.t('error.nameRequired') });
    maxLength(path.name, 200);

    required(path.kcal, { message: this.i18n.t('error.numberRequired') });
    min(path.kcal, 0, { message: this.i18n.t('error.kcalRange') });
    max(path.kcal, 900, { message: this.i18n.t('error.kcalRange') });

    for (const macro of [path.protein, path.carbs, path.fat]) {
      required(macro, { message: this.i18n.t('error.numberRequired') });
      min(macro, 0, { message: this.i18n.t('error.macroRange') });
      max(macro, 100, { message: this.i18n.t('error.macroRange') });
    }

    // Optional, so `null` is valid — but a supplied value has to be a real portion.
    // `min` alone would not express that, since it treats an empty field as nothing to check.
    validate(path.servingSizeG, ({ value }) => {
      const grams = value();
      return grams !== null && grams <= 0
        ? { kind: 'servingPositive', message: this.i18n.t('error.servingPositive') }
        : null;
    });
  });

  protected submit(event: Event): void {
    event.preventDefault();
    this.submitted.set(true);
    if (this.foodForm().invalid()) return;

    const draft = this.draft();
    this.save.emit({
      name: draft.name.trim(),
      brand: draft.brand.trim() || null,
      servingSizeG: draft.servingSizeG,
      // Non-null: `required` above rejects an empty field, so a valid form has all four.
      kcalPer100g: draft.kcal!,
      proteinPer100g: draft.protein!,
      carbsPer100g: draft.carbs!,
      fatPer100g: draft.fat!,
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

// An existing food seeds the draft; a new one starts blank rather than at 0, so the user
// types into empty fields instead of clearing zeros.
function toDraft(food: CustomFood | null): FoodDraft {
  return {
    name: food?.name ?? '',
    brand: food?.brand ?? '',
    kcal: food?.kcalPer100g ?? null,
    protein: food?.proteinPer100g ?? null,
    carbs: food?.carbsPer100g ?? null,
    fat: food?.fatPer100g ?? null,
    servingSizeG: food?.servingSizeG ?? null,
  };
}
