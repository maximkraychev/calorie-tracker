import { computed, inject, Service, signal } from '@angular/core';

import { RecipesApi } from './recipes.api';
import {
  deriveNutrition,
  filterRecipes,
  type NewRecipe,
  type Recipe,
} from '../models/recipe.models';

// Load state of the list.
type ListStatus = 'loading' | 'ready' | 'error';

/**
 * Which recipe the sheet is open on, if any.
 *
 * The extra 'loading' state is the one thing this store has that FoodsStore does not: the
 * list response omits ingredient arrays, so editing has to fetch the detail first and the
 * sheet cannot open until it lands.
 */
type SheetState = { mode: 'create' } | { mode: 'loading' } | { mode: 'edit'; recipe: Recipe };

// The user's recipes. Root-provided, so the My Recipes page and the Add-Food overlay share
// one loaded copy — opening the overlay's Recipes chip after visiting the page costs no
// request. Mirrors FoodsStore throughout: optimistic mutations, reconciled or rolled back
// on the API response.
@Service()
export class RecipesStore {
  private readonly api = inject(RecipesApi);

  private readonly _recipes = signal<Recipe[]>([]);
  private readonly _status = signal<ListStatus>('loading');
  private readonly _query = signal('');
  private readonly _sheet = signal<SheetState | null>(null);

  // Whether a fetch has been kicked off — non-reactive, so `ensureLoaded` can be called
  // from anywhere (a page, an overlay) without re-entering itself.
  private requested = false;

  readonly recipes = this._recipes.asReadonly();
  readonly status = this._status.asReadonly();
  readonly query = this._query.asReadonly();
  readonly sheet = this._sheet.asReadonly();

  /** The list narrowed by the page's search box. */
  readonly filtered = computed(() => filterRecipes(this._recipes(), this._query()));

  /** Fetch the list the first time something needs it. */
  ensureLoaded(): void {
    if (!this.requested) this.load();
  }

  /** Re-fetch after a failed load (the error state's retry button). */
  reload(): void {
    this.load();
  }

  setQuery(query: string): void {
    this._query.set(query);
  }

  openCreate(): void {
    this._sheet.set({ mode: 'create' });
  }

  // Opens on the detail response, not on the list row: only the detail carries the
  // ingredients, and a sheet seeded from the list would open an ingredients recipe empty
  // and then save that emptiness back.
  openEdit(id: string): void {
    if (id.startsWith('temp-')) return;
    this._sheet.set({ mode: 'loading' });
    this.api.get(id).subscribe({
      next: (recipe) => {
        // Guard against a close (or a second open) landing while this was in flight.
        if (this._sheet()?.mode === 'loading') this._sheet.set({ mode: 'edit', recipe });
      },
      error: () => this._sheet.set(null),
    });
  }

  closeSheet(): void {
    this._sheet.set(null);
  }

  // Show the new recipe immediately with a temporary id, then swap it for the server row
  // (which carries the real id and the authoritative numbers); on failure it is removed.
  create(input: NewRecipe): void {
    const tempId = `temp-${crypto.randomUUID()}`;
    this._recipes.update((recipes) => sortByName([...recipes, toOptimistic(input, tempId)]));

    this.api.create(input).subscribe({
      next: (created) =>
        this._recipes.update((recipes) =>
          sortByName(recipes.map((recipe) => (recipe.id === tempId ? created : recipe))),
        ),
      error: () =>
        this._recipes.update((recipes) => recipes.filter((recipe) => recipe.id !== tempId)),
    });
  }

  update(id: string, input: NewRecipe): void {
    // A row still waiting on its POST has no server id to PUT to.
    if (id.startsWith('temp-')) return;
    const previous = this._recipes().find((recipe) => recipe.id === id);
    if (!previous) return;

    this._recipes.update((recipes) =>
      sortByName(recipes.map((r) => (r.id === id ? toOptimistic(input, id) : r))),
    );
    this.api.update(id, input).subscribe({
      next: (updated) =>
        this._recipes.update((recipes) =>
          sortByName(recipes.map((recipe) => (recipe.id === id ? updated : recipe))),
        ),
      error: () =>
        this._recipes.update((recipes) =>
          sortByName(recipes.map((r) => (r.id === id ? previous : r))),
        ),
    });
  }

  remove(id: string): void {
    if (id.startsWith('temp-')) return;
    const snapshot = this._recipes();
    this._recipes.update((recipes) => recipes.filter((recipe) => recipe.id !== id));
    this.api.remove(id).subscribe({
      // Restore the whole list on failure (simplest correct rollback).
      error: () => this._recipes.set(snapshot),
    });
  }

  private load(): void {
    this.requested = true;
    this._status.set('loading');
    this.api.list().subscribe({
      next: (recipes) => {
        this._recipes.set(recipes);
        this._status.set('ready');
      },
      error: () => this._status.set('error'),
    });
  }
}

// A submitted recipe rendered as a list row before the server has answered. The derived
// numbers use the same math the server does, so the row does not visibly change when the
// real response replaces it.
function toOptimistic(input: NewRecipe, id: string): Recipe {
  const { totalWeightG, totals, per100g } = deriveNutrition(input);
  return { id, name: input.name, mode: input.mode, totalWeightG, totals, ...per100g };
}

// The API returns the list alphabetically; optimistic rows have to be inserted in the same
// order or a new recipe would appear at the bottom and then jump on reconciliation.
function sortByName(recipes: Recipe[]): Recipe[] {
  return [...recipes].sort((a, b) => a.name.localeCompare(b.name));
}
