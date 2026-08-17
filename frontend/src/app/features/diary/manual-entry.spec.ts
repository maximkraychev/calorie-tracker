import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { macrosOf, round1 } from '../../shared/utils/nutrition.utils';
import type { NewRecipeIngredient } from '../recipes/models/recipe.models';
import { AddFoodOverlay } from './components/add-food-overlay';
import { ManualEntryPane } from './components/manual-entry-pane';
import type { LogEntry, MealType } from './models/diary.models';

describe('ManualEntryPane', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  function mount(purpose: 'log' | 'pick' = 'log', meal: MealType | null = 'lunch') {
    const fixture = TestBed.createComponent(ManualEntryPane);
    fixture.componentRef.setInput('purpose', purpose);
    fixture.componentRef.setInput('meal', meal);
    fixture.detectChanges();
    return fixture;
  }

  /** Fill the form the way the user would, leaving out whatever the test omits. */
  function fill(
    pane: ManualEntryPane,
    values: Partial<{
      name: string;
      kcal: number;
      protein: number;
      carbs: number;
      fat: number;
      grams: number;
    }>,
  ) {
    const form = pane['manualForm'];
    for (const [key, value] of Object.entries(values)) {
      form[key as keyof typeof values]().value.set(value as never);
    }
  }

  function logsOf(pane: ManualEntryPane): Omit<LogEntry, 'id'>[] {
    const emitted: Omit<LogEntry, 'id'>[] = [];
    pane.log.subscribe((value) => emitted.push(value));
    return emitted;
  }

  it('starts blank, with the portion falling back to a nominal 100 g', () => {
    const pane = mount().componentInstance;
    expect(pane['manualForm'].name().value()).toBe('');
    expect(pane['manualForm'].kcal().value()).toBeNull();
    expect(pane['manualForm'].grams().value()).toBeNull();
    expect(pane['portionGrams']()).toBe(100);
  });

  it('defaults the meal to the one the overlay was opened from', () => {
    expect(mount('log', 'dinner').componentInstance['targetMeal']()).toBe('dinner');
  });

  // The point of the no-weight path: the entry has to add up to exactly what was typed.
  it('logs the typed totals unchanged when no weight is given', () => {
    const pane = mount().componentInstance;
    const emitted = logsOf(pane);

    fill(pane, { name: 'Banitsa', kcal: 520, protein: 14, carbs: 48, fat: 30 });
    pane['submit'](new Event('submit'));

    expect(emitted).toHaveLength(1);
    const entry = emitted[0]!;
    expect(entry.grams).toBe(100);
    expect(entry.kcalPer100g).toBe(520);
    expect(macrosOf(entry)).toEqual({ kcal: 520, protein: 14, carbs: 48, fat: 30 });
  });

  it('derives per-100g from a stated weight, and still totals what was typed', () => {
    const pane = mount().componentInstance;
    const emitted = logsOf(pane);

    fill(pane, { name: 'Banitsa', kcal: 520, protein: 14, carbs: 48, fat: 30, grams: 180 });
    pane['submit'](new Event('submit'));

    const entry = emitted[0]!;
    expect(entry.grams).toBe(180);
    expect(round1(entry.kcalPer100g)).toBe(288.9);
    const macros = macrosOf(entry);
    expect(round1(macros.kcal)).toBe(520);
    expect(round1(macros.protein)).toBe(14);
  });

  it('reads an omitted macro as 0 rather than blocking the log', () => {
    const pane = mount().componentInstance;
    const emitted = logsOf(pane);

    fill(pane, { name: 'Black coffee', kcal: 5 });
    pane['submit'](new Event('submit'));

    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.proteinPer100g).toBe(0);
    expect(emitted[0]!.fatPer100g).toBe(0);
  });

  it('trims the name and logs no catalog provenance', () => {
    const pane = mount().componentInstance;
    const emitted = logsOf(pane);

    fill(pane, { name: '  Grandma pie  ', kcal: 300 });
    pane['submit'](new Event('submit'));

    const entry = emitted[0]!;
    expect(entry.name).toBe('Grandma pie');
    expect(entry.source).toBe('manual');
    expect(entry.mealType).toBe('lunch');
    expect(entry.externalId).toBeNull();
    expect(entry.customFoodId).toBeNull();
    expect(entry.recipeId).toBeNull();
  });

  it('refuses to log without a name', () => {
    const pane = mount().componentInstance;
    const emitted = logsOf(pane);

    fill(pane, { kcal: 300 });
    pane['submit'](new Event('submit'));

    expect(emitted).toEqual([]);
  });

  // Calories are the one number with no sensible default — an empty field is not a 0.
  it('refuses to log without calories', () => {
    const pane = mount().componentInstance;
    const emitted = logsOf(pane);

    fill(pane, { name: 'Mystery snack', protein: 12 });
    pane['submit'](new Event('submit'));

    expect(emitted).toEqual([]);
  });

  it('rejects a weight of zero, which the API would 400 on', () => {
    const pane = mount().componentInstance;
    const emitted = logsOf(pane);

    fill(pane, { name: 'Weightless', kcal: 300, grams: 0 });
    pane['submit'](new Event('submit'));

    expect(emitted).toEqual([]);
    // The live preview must not divide by it either.
    expect(pane['per100g']().kcalPer100g).toBe(0);
  });

  // Over 900 kcal in a nominal 100 g portion exceeds what a diary entry can hold, and the
  // fix the message asks for — a real weight — has to actually clear it.
  it('blocks a portion too dense for 100 g until a weight is given', () => {
    const pane = mount().componentInstance;
    const emitted = logsOf(pane);

    fill(pane, { name: 'Big dinner', kcal: 1200, protein: 60, carbs: 90, fat: 55 });
    expect(pane['outOfRange']()).toBe(true);
    pane['submit'](new Event('submit'));
    expect(emitted).toEqual([]);

    fill(pane, { grams: 600 });
    expect(pane['outOfRange']()).toBe(false);
    pane['submit'](new Event('submit'));
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.kcalPer100g).toBe(200);
  });

  it('blocks a macro that exceeds 100 g per 100 g', () => {
    const pane = mount().componentInstance;
    fill(pane, { name: 'Impossible', kcal: 400, protein: 120, grams: 100 });
    expect(pane['outOfRange']()).toBe(true);
  });

  it('emits a recipe ingredient instead of a log entry in pick mode', () => {
    const pane = mount('pick', null).componentInstance;
    const emitted: NewRecipeIngredient[] = [];
    const logged: Omit<LogEntry, 'id'>[] = [];
    pane.pickIngredient.subscribe((value) => emitted.push(value));
    pane.log.subscribe((value) => logged.push(value));

    fill(pane, { name: 'Homemade stock', kcal: 40, protein: 2, grams: 250 });
    pane['submit'](new Event('submit'));

    expect(logged).toEqual([]);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      name: 'Homemade stock',
      brand: null,
      source: 'manual',
      customFoodId: null,
      externalId: null,
      grams: 250,
      kcalPer100g: 16,
    });
  });
});

// The chip → pane wiring, which the pane's own tests cannot see: the manual chip has to be
// enabled, select the pane, and pass an entry back out through the overlay.
describe('AddFoodOverlay manual chip', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  function open(purpose: 'log' | 'pick' = 'log') {
    const fixture = TestBed.createComponent(AddFoodOverlay);
    fixture.componentRef.setInput('purpose', purpose);
    fixture.componentRef.setInput('meal', purpose === 'log' ? 'breakfast' : null);
    fixture.detectChanges();
    return fixture;
  }

  function host(fixture: ReturnType<typeof open>): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function manualChip(fixture: ReturnType<typeof open>): HTMLButtonElement {
    const chips = [...host(fixture).querySelectorAll<HTMLButtonElement>('.chip')];
    const chip = chips.find((c) => c.textContent?.includes('Manual'));
    if (!chip) throw new Error('no manual chip rendered');
    return chip;
  }

  it('offers manual entry as an enabled chip in both purposes', () => {
    expect(manualChip(open('log')).disabled).toBe(false);
    expect(manualChip(open('pick')).disabled).toBe(false);
  });

  it('swaps the browse pane for the manual form when the chip is tapped', () => {
    const fixture = open();
    expect(host(fixture).querySelector('ct-manual-entry-pane')).toBeNull();

    manualChip(fixture).click();
    fixture.detectChanges();

    expect(host(fixture).querySelector('ct-manual-entry-pane')).not.toBeNull();
    // The search pane is gone, so its box cannot be showing underneath.
    expect(host(fixture).querySelector('.searchbox')).toBeNull();
  });

  it('re-emits a manual entry from the pane as the overlay own log output', () => {
    const fixture = open();
    const emitted: Omit<LogEntry, 'id'>[] = [];
    fixture.componentInstance.log.subscribe((value) => emitted.push(value));

    manualChip(fixture).click();
    fixture.detectChanges();

    const pane = fixture.debugElement.query(By.directive(ManualEntryPane))
      .componentInstance as ManualEntryPane;
    pane['manualForm'].name().value.set('Street banitsa');
    pane['manualForm'].kcal().value.set(430);
    pane['submit'](new Event('submit'));

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ name: 'Street banitsa', source: 'manual', grams: 100 });
    expect(emitted[0]!.mealType).toBe('breakfast');
  });
});
