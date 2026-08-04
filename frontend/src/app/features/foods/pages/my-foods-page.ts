import { Component, inject } from '@angular/core';

import { I18n } from '../../../core/i18n/i18n';
import { Icon } from '../../../shared/ui/icon';
import { round } from '../../../shared/utils/nutrition.utils';
import { CustomFoodSheet } from '../components/custom-food-sheet';
import { FoodsStore } from '../data/foods.store';
import type { CustomFood, NewCustomFood } from '../models/custom-food.models';

// The My Foods tab: the user's own food catalog, with create / edit / delete.
//
// Filtering is client-side over the loaded list (see `filterFoods`), so there is no
// debounce and no per-keystroke request — the whole catalog fits in memory.
@Component({
  selector: 'ct-my-foods-page',
  imports: [Icon, CustomFoodSheet],
  template: `
    <div class="page">
      <div class="head">
        <h2>{{ i18n.t('myFoods.title') }}</h2>
        <button class="btn btn-primary add" type="button" (click)="store.openCreate()">
          <ct-icon name="plus" [size]="18" />
          {{ i18n.t('myFoods.add') }}
        </button>
      </div>

      @switch (store.status()) {
        @case ('loading') {
          <div class="spinner" role="status" [attr.aria-label]="i18n.t('myFoods.loading')"></div>
        }
        @case ('error') {
          <div class="text-muted note">{{ i18n.t('myFoods.loadError') }}</div>
          <button class="btn btn-secondary" type="button" (click)="store.reload()">
            {{ i18n.t('diary.retry') }}
          </button>
        }
        @case ('ready') {
          @if (store.foods().length === 0) {
            <div class="empty">
              <div class="empty-title">{{ i18n.t('myFoods.emptyTitle') }}</div>
              <p class="text-muted empty-body">{{ i18n.t('myFoods.emptyBody') }}</p>
              <button class="btn btn-secondary" type="button" (click)="store.openCreate()">
                <ct-icon name="plus" [size]="18" />
                {{ i18n.t('myFoods.add') }}
              </button>
            </div>
          } @else {
            <div class="searchbox">
              <ct-icon class="search-icon" name="search" [size]="18" />
              <input
                class="input query"
                type="text"
                enterkeyhint="search"
                [placeholder]="i18n.t('myFoods.searchPlaceholder')"
                [attr.aria-label]="i18n.t('myFoods.searchPlaceholder')"
                [value]="store.query()"
                (input)="onQueryInput($event)"
              />
            </div>

            @if (store.filtered().length === 0) {
              <div class="text-muted note">{{ i18n.t('myFoods.noMatches') }}</div>
            } @else {
              @for (food of store.filtered(); track food.id) {
                <button
                  class="result"
                  type="button"
                  [attr.aria-label]="i18n.t('myFoods.editAria', { name: food.name })"
                  (click)="store.openEdit(food)"
                >
                  <span class="result-text">
                    <span class="result-name">{{ food.name }}</span>
                    <span class="text-muted result-meta">{{ meta(food) }}</span>
                  </span>
                  <ct-icon class="result-chevron" name="chevron-right" [size]="18" />
                </button>
              }
            }
          }
        }
      }

      @if (store.sheet(); as sheet) {
        <ct-custom-food-sheet
          [food]="sheet.mode === 'edit' ? sheet.food : null"
          (save)="onSave($event)"
          (delete)="onDelete()"
          (close)="store.closeSheet()"
        />
      }
    </div>
  `,
  styles: `
    .page { padding: var(--space-4) var(--space-4) 90px; }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
      margin-bottom: var(--space-4);
    }
    h2 { font-size: 28px; }
    .add { flex: none; gap: 6px; }

    .searchbox {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      background: var(--color-surface);
      border: 1px solid var(--color-divider);
      padding: 0 10px;
      border-radius: 12px;
      margin-bottom: var(--space-4);
      transition:
        border-color 0.15s ease,
        box-shadow 0.15s ease;
    }
    /* The field is borderless inside the box, so the focus ring belongs on the box
       (wrapping icon + input), not the inner input. */
    .searchbox:focus-within {
      border-color: var(--color-accent);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 22%, transparent);
    }
    .search-icon { opacity: 0.5; }
    .query { flex: 1; border: 0; background: transparent; padding-left: 0; }
    /* Suppress the global .input focus ring on the inner field (higher specificity wins). */
    .searchbox .query:focus-visible { outline: none; border: 0; box-shadow: none; }

    .note { font-size: 13px; padding: var(--space-4) 0; }
    .spinner {
      width: 44px;
      height: 44px;
      border: 3px solid var(--color-divider);
      border-top-color: var(--color-accent);
      border-radius: 50%;
      margin: var(--space-6) auto;
      animation: ct-mf-spin 0.8s linear infinite;
    }
    @keyframes ct-mf-spin {
      to { transform: rotate(360deg); }
    }

    .empty { text-align: center; padding: var(--space-7) var(--space-2); }
    .empty-title {
      font-family: var(--font-heading);
      font-weight: 800;
      font-size: 18px;
      margin-bottom: var(--space-2);
    }
    .empty-body { font-size: 14px; margin-bottom: var(--space-5); }

    .result {
      display: flex;
      width: 100%;
      text-align: left;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-3) 0;
      border: 0;
      border-bottom: 1px solid var(--color-divider);
      background: transparent;
      cursor: pointer;
      color: inherit;
      font: inherit;
    }
    .result-text { flex: 1; min-width: 0; }
    .result-name { display: block; font-weight: 600; font-size: 15px; }
    .result-meta { display: block; font-size: 12px; }
    .result-chevron { opacity: 0.4; }
  `,
})
export class MyFoodsPage {
  protected readonly i18n = inject(I18n);
  protected readonly store = inject(FoodsStore);

  constructor() {
    this.store.ensureLoaded();
  }

  protected meta(food: CustomFood): string {
    const brand = food.brand ? `${food.brand} · ` : '';
    return `${brand}${round(food.kcalPer100g)} ${this.i18n.t('entry.kcalPer100')}`;
  }

  protected onQueryInput(event: Event): void {
    this.store.setQuery((event.target as HTMLInputElement).value);
  }

  protected onSave(input: NewCustomFood): void {
    const sheet = this.store.sheet();
    if (!sheet) return;
    if (sheet.mode === 'edit') this.store.update(sheet.food.id, input);
    else this.store.create(input);
    this.store.closeSheet();
  }

  protected onDelete(): void {
    const sheet = this.store.sheet();
    if (sheet?.mode !== 'edit') return;
    this.store.remove(sheet.food.id);
    this.store.closeSheet();
  }
}
