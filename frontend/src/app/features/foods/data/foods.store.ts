import { computed, inject, Service, signal } from '@angular/core';

import { FoodsApi } from './foods.api';
import { filterFoods, type CustomFood, type NewCustomFood } from '../models/custom-food.models';

// Load state of the catalog.
type CatalogStatus = 'loading' | 'ready' | 'error';

/** Which food the edit sheet is open on, if any. */
type SheetState = { mode: 'create' } | { mode: 'edit'; food: CustomFood };

// The user's custom food catalog. Root-provided, so the My Foods page and the Add-Food
// overlay share one loaded copy — opening the overlay's My Foods chip after visiting the
// page costs no request.
//
// Unlike DiaryStore there is only one collection to track, so the load guard is a plain
// boolean rather than a per-key Set. Mutations are optimistic (applied immediately,
// reconciled or rolled back on the API response), same contract as the diary.
@Service()
export class FoodsStore {
  private readonly api = inject(FoodsApi);

  private readonly _foods = signal<CustomFood[]>([]);
  private readonly _status = signal<CatalogStatus>('loading');
  private readonly _query = signal('');
  private readonly _sheet = signal<SheetState | null>(null);

  // Whether a fetch has been kicked off — non-reactive, so `ensureLoaded` can be called
  // from anywhere (a page, an overlay) without re-entering itself.
  private requested = false;

  readonly foods = this._foods.asReadonly();
  readonly status = this._status.asReadonly();
  readonly query = this._query.asReadonly();
  readonly sheet = this._sheet.asReadonly();

  /** The catalog narrowed by the page's search box. */
  readonly filtered = computed(() => filterFoods(this._foods(), this._query()));

  /** Fetch the catalog the first time something needs it. */
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

  openEdit(food: CustomFood): void {
    this._sheet.set({ mode: 'edit', food });
  }

  closeSheet(): void {
    this._sheet.set(null);
  }

  // Show the new food immediately with a temporary id, then swap it for the server row
  // (which carries the real id); on failure the optimistic row is removed.
  create(input: NewCustomFood): void {
    const tempId = `temp-${crypto.randomUUID()}`;
    this._foods.update((foods) => sortByName([...foods, { ...input, id: tempId }]));

    this.api.create(input).subscribe({
      next: (created) =>
        this._foods.update((foods) =>
          sortByName(foods.map((food) => (food.id === tempId ? created : food))),
        ),
      error: () => this._foods.update((foods) => foods.filter((food) => food.id !== tempId)),
    });
  }

  update(id: string, input: NewCustomFood): void {
    // A row still waiting on its POST has no server id to PUT to.
    if (id.startsWith('temp-')) return;
    const previous = this._foods().find((food) => food.id === id);
    if (!previous) return;

    this._foods.update((foods) =>
      sortByName(foods.map((food) => (food.id === id ? { ...input, id } : food))),
    );
    this.api.update(id, input).subscribe({
      next: (updated) =>
        this._foods.update((foods) =>
          sortByName(foods.map((food) => (food.id === id ? updated : food))),
        ),
      error: () =>
        this._foods.update((foods) => sortByName(foods.map((f) => (f.id === id ? previous : f)))),
    });
  }

  remove(id: string): void {
    if (id.startsWith('temp-')) return;
    const snapshot = this._foods();
    this._foods.update((foods) => foods.filter((food) => food.id !== id));
    this.api.remove(id).subscribe({
      // Restore the whole list on failure (simplest correct rollback).
      error: () => this._foods.set(snapshot),
    });
  }

  private load(): void {
    this.requested = true;
    this._status.set('loading');
    this.api.list().subscribe({
      next: (foods) => {
        this._foods.set(foods);
        this._status.set('ready');
      },
      error: () => this._status.set('error'),
    });
  }
}

// The API returns the catalog alphabetically; optimistic rows have to be inserted in the
// same order or a new food would appear at the bottom and then jump on reconciliation.
function sortByName(foods: CustomFood[]): CustomFood[] {
  return [...foods].sort((a, b) => a.name.localeCompare(b.name));
}
