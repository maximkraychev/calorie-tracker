import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { RecipeSheet } from './components/recipe-sheet';
import { RecipesStore } from './data/recipes.store';
import {
  deriveNutrition,
  filterRecipes,
  type NewRecipe,
  type Recipe,
  type RecipeIngredient,
} from './models/recipe.models';

const tomato: RecipeIngredient = {
  id: 'i1',
  name: 'Tomato',
  brand: null,
  source: 'generic',
  customFoodId: null,
  externalId: 'usda:11529',
  grams: 200,
  kcalPer100g: 18,
  proteinPer100g: 0.9,
  carbsPer100g: 3.9,
  fatPer100g: 0.2,
};

const sirene: RecipeIngredient = {
  id: 'i2',
  name: 'Sirene',
  brand: 'Vereya',
  source: 'custom',
  customFoodId: 'cf1',
  externalId: null,
  grams: 100,
  kcalPer100g: 260,
  proteinPer100g: 17,
  carbsPer100g: 2,
  fatPer100g: 21,
};

// 200 g tomato (36 kcal) + 100 g sirene (260 kcal) = 296 kcal over 300 g.
const shopska: Recipe = {
  id: 'r1',
  name: 'Shopska Salad',
  mode: 'ingredients',
  totalWeightG: 300,
  totals: { kcal: 296, protein: 18.8, carbs: 9.8, fat: 21.4 },
  kcalPer100g: 98.67,
  proteinPer100g: 6.27,
  carbsPer100g: 3.27,
  fatPer100g: 7.13,
};

const moussaka: Recipe = {
  id: 'r2',
  name: 'Moussaka',
  mode: 'manual',
  totalWeightG: 2400,
  totals: { kcal: 3600, protein: 180, carbs: 300, fat: 170 },
  kcalPer100g: 150,
  proteinPer100g: 7.5,
  carbsPer100g: 12.5,
  fatPer100g: 7.08,
};

/** The same recipe as the API sends it — nutrition nested under `per100g`/`totals`. */
function dto(recipe: Recipe, ingredients?: RecipeIngredient[]) {
  return {
    id: recipe.id,
    source: 'recipe',
    name: recipe.name,
    mode: recipe.mode,
    totalWeightG: recipe.totalWeightG,
    totals: recipe.totals,
    per100g: {
      kcal: recipe.kcalPer100g,
      protein: recipe.proteinPer100g,
      carbs: recipe.carbsPer100g,
      fat: recipe.fatPer100g,
    },
    ...(ingredients
      ? {
          ingredients: ingredients.map((i) => ({
            id: i.id,
            name: i.name,
            brand: i.brand,
            source: i.source,
            customFoodId: i.customFoodId,
            externalId: i.externalId,
            grams: i.grams,
            per100g: {
              kcal: i.kcalPer100g,
              protein: i.proteinPer100g,
              carbs: i.carbsPer100g,
              fat: i.fatPer100g,
            },
          })),
        }
      : {}),
  };
}

describe('filterRecipes', () => {
  const recipes = [shopska, moussaka];

  it('returns everything for a blank query', () => {
    expect(filterRecipes(recipes, '  ')).toHaveLength(2);
  });

  it('matches the name case-insensitively', () => {
    expect(filterRecipes(recipes, 'MOUSS').map((r) => r.id)).toEqual(['r2']);
  });

  it('returns nothing when there is no match', () => {
    expect(filterRecipes(recipes, 'zzz')).toEqual([]);
  });
});

describe('deriveNutrition', () => {
  it('sums ingredients and defaults the weight to their gram total', () => {
    const derived = deriveNutrition({
      name: 'Shopska Salad',
      mode: 'ingredients',
      totalWeightG: null,
      ingredients: [tomato, sirene],
    });

    expect(derived.totalWeightG).toBe(300);
    expect(derived.totals.kcal).toBeCloseTo(296, 5);
    expect(derived.per100g.kcalPer100g).toBeCloseTo(98.667, 2);
  });

  it('concentrates the per-100g values when a cooked weight is set', () => {
    // 300 g of ingredients reduced to 200 g means half again as much per 100 g.
    const derived = deriveNutrition({
      name: 'Reduced',
      mode: 'ingredients',
      totalWeightG: 200,
      ingredients: [tomato, sirene],
    });

    expect(derived.totalWeightG).toBe(200);
    expect(derived.per100g.kcalPer100g).toBeCloseTo(148, 5);
  });

  it('derives per-100g from the stored totals in manual mode', () => {
    const derived = deriveNutrition({
      name: 'Moussaka',
      mode: 'manual',
      totalWeightG: 2400,
      totals: { kcal: 3600, protein: 180, carbs: 300, fat: 170 },
    });

    expect(derived.per100g.kcalPer100g).toBe(150);
  });

  it('survives an empty ingredient list rather than dividing by zero', () => {
    const derived = deriveNutrition({
      name: 'Empty',
      mode: 'ingredients',
      totalWeightG: null,
      ingredients: [],
    });

    expect(derived.totalWeightG).toBe(0);
    expect(derived.per100g.kcalPer100g).toBe(0);
  });
});

describe('RecipesStore', () => {
  let store: RecipesStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(RecipesStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function load(recipes: Recipe[] = []): void {
    store.ensureLoaded();
    http.expectOne('/api/recipes').flush(recipes.map((r) => dto(r)));
  }

  const newShopska: NewRecipe = {
    name: 'Shopska Salad',
    mode: 'ingredients',
    totalWeightG: null,
    ingredients: [tomato, sirene],
  };

  it('loads once and flattens the wire per100g object', () => {
    load([shopska]);
    expect(store.status()).toBe('ready');
    expect(store.recipes()[0]).toEqual(shopska);

    // A second caller must not re-request.
    store.ensureLoaded();
    http.expectNone('/api/recipes');
  });

  it('reports a failed load so the page can offer a retry', () => {
    store.ensureLoaded();
    http.expectOne('/api/recipes').error(new ProgressEvent('fail'));
    expect(store.status()).toBe('error');
  });

  it('shows a created recipe immediately with locally derived totals', () => {
    load();
    store.create(newShopska);

    // Optimistic: visible before the POST resolves, under a temporary id, and already
    // showing the numbers the server will confirm.
    expect(store.recipes()).toHaveLength(1);
    expect(store.recipes()[0]!.id).toMatch(/^temp-/);
    expect(store.recipes()[0]!.totalWeightG).toBe(300);
    expect(store.recipes()[0]!.kcalPer100g).toBeCloseTo(98.667, 2);

    const req = http.expectOne('/api/recipes');
    expect(req.request.method).toBe('POST');
    req.flush(dto(shopska, [tomato, sirene]));

    expect(store.recipes()[0]!.id).toBe('r1');
  });

  it('sends a custom ingredient as an id and a portion, never its nutrition', () => {
    load();
    store.create(newShopska);

    const req = http.expectOne('/api/recipes');
    const [first, second] = req.request.body.ingredients;
    // The generic pick carries its snapshot; the custom one carries only provenance.
    expect(first.per100g).toEqual({ kcal: 18, protein: 0.9, carbs: 3.9, fat: 0.2 });
    expect(second).toEqual({ source: 'custom', customFoodId: 'cf1', grams: 100 });

    req.flush(dto(shopska, [tomato, sirene]));
  });

  it('downgrades a custom ingredient whose food was deleted to a manual snapshot', () => {
    load();
    // custom_food_id is ON DELETE SET NULL, so this shape does come back from the API.
    const orphaned = { ...sirene, customFoodId: null };
    store.create({ ...newShopska, ingredients: [orphaned] });

    const req = http.expectOne('/api/recipes');
    const [only] = req.request.body.ingredients;
    expect(only.source).toBe('manual');
    expect(only.per100g).toEqual({ kcal: 260, protein: 17, carbs: 2, fat: 21 });

    req.flush(dto(shopska, [tomato]));
  });

  it('rolls the optimistic row back when the create fails', () => {
    load();
    store.create(newShopska);
    expect(store.recipes()).toHaveLength(1);

    http.expectOne('/api/recipes').error(new ProgressEvent('fail'));
    expect(store.recipes()).toEqual([]);
  });

  it('restores the previous list when a delete fails', () => {
    load([shopska]);
    store.remove('r1');
    expect(store.recipes()).toEqual([]);

    http.expectOne('/api/recipes/r1').error(new ProgressEvent('fail'));
    expect(store.recipes()).toEqual([shopska]);
  });

  it('fetches the detail before opening the edit sheet', () => {
    load([shopska]);
    store.openEdit('r1');

    // The list response has no ingredients, so the sheet waits on the detail call.
    expect(store.sheet()).toEqual({ mode: 'loading' });
    http.expectOne('/api/recipes/r1').flush(dto(shopska, [tomato, sirene]));

    const sheet = store.sheet();
    expect(sheet?.mode).toBe('edit');
    expect(sheet?.mode === 'edit' && sheet.recipe.ingredients).toHaveLength(2);
  });

  it('closes the sheet when the detail fetch fails', () => {
    load([shopska]);
    store.openEdit('r1');
    http.expectOne('/api/recipes/r1').error(new ProgressEvent('fail'));
    expect(store.sheet()).toBeNull();
  });

  it('ignores mutations on a row still awaiting its POST', () => {
    load();
    store.create(newShopska);
    const tempId = store.recipes()[0]!.id;
    const create = http.expectOne('/api/recipes');

    store.remove(tempId);
    store.update(tempId, newShopska);
    store.openEdit(tempId);
    http.expectNone((req) => req.url.startsWith('/api/recipes/'));

    create.flush(dto(shopska, [tomato, sirene]));
  });
});

describe('RecipeSheet', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  function mount(recipe: Recipe | null) {
    const fixture = TestBed.createComponent(RecipeSheet);
    fixture.componentRef.setInput('recipe', recipe);
    fixture.detectChanges();
    return fixture;
  }

  it('starts blank in ingredients mode for a new recipe', () => {
    const fixture = mount(null);
    const sheet = fixture.componentInstance;
    expect(sheet['mode']()).toBe('ingredients');
    expect(sheet['ingredients']()).toEqual([]);
    expect(sheet['recipeForm'].name().value()).toBe('');
  });

  it('seeds mode and ingredients from the recipe being edited', () => {
    const fixture = mount({ ...shopska, ingredients: [tomato, sirene] });
    const sheet = fixture.componentInstance;
    expect(sheet['mode']()).toBe('ingredients');
    expect(sheet['ingredients']().map((i) => i.name)).toEqual(['Tomato', 'Sirene']);
    // Not pre-filled: the stored weight is the computed sum, not a deliberate override.
    expect(sheet['recipeForm'].totalWeightG().value()).toBeNull();
  });

  it('seeds the manual totals and weight when editing a manual recipe', () => {
    const fixture = mount(moussaka);
    const form = fixture.componentInstance['recipeForm'];
    expect(fixture.componentInstance['mode']()).toBe('manual');
    expect(form.totalWeightG().value()).toBe(2400);
    expect(form.kcal().value()).toBe(3600);
  });

  it('refuses to submit an ingredients recipe with no ingredients', () => {
    const fixture = mount(null);
    const sheet = fixture.componentInstance;
    const emitted: NewRecipe[] = [];
    sheet.save.subscribe((value) => emitted.push(value));

    sheet['recipeForm'].name().value.set('Empty');
    sheet['submit'](new Event('submit'));

    expect(emitted).toEqual([]);
    expect(sheet['hasIngredients']()).toBe(false);
  });

  it('emits a trimmed ingredients recipe once one has been added', () => {
    const fixture = mount(null);
    const sheet = fixture.componentInstance;
    const emitted: NewRecipe[] = [];
    sheet.save.subscribe((value) => emitted.push(value));

    sheet['recipeForm'].name().value.set('  Shopska Salad  ');
    const { id: _id, ...picked } = tomato;
    sheet['addIngredient'](picked);
    sheet['submit'](new Event('submit'));

    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.name).toBe('Shopska Salad');
    expect(emitted[0]!.mode).toBe('ingredients');
    // The local list key must not leak into the request.
    expect(emitted[0]!.mode === 'ingredients' && emitted[0]!.ingredients[0]).not.toHaveProperty(
      'key',
    );
  });

  it('blocks a save whose derived per-100g exceeds what a diary entry can hold', () => {
    const fixture = mount(null);
    const sheet = fixture.componentInstance;
    const emitted: NewRecipe[] = [];
    sheet.save.subscribe((value) => emitted.push(value));

    sheet['mode'].set('manual');
    sheet['recipeForm'].name().value.set('Impossible');
    sheet['recipeForm'].totalWeightG().value.set(100);
    sheet['recipeForm'].kcal().value.set(5000);
    sheet['recipeForm'].protein().value.set(10);
    sheet['recipeForm'].carbs().value.set(10);
    sheet['recipeForm'].fat().value.set(10);

    expect(sheet['outOfRange']()).toBe(true);
    sheet['submit'](new Event('submit'));
    expect(emitted).toEqual([]);
  });

  it('refuses to submit a manual recipe missing its totals', () => {
    const fixture = mount(null);
    const sheet = fixture.componentInstance;
    const emitted: NewRecipe[] = [];
    sheet.save.subscribe((value) => emitted.push(value));

    sheet['mode'].set('manual');
    sheet['recipeForm'].name().value.set('Half filled');
    sheet['recipeForm'].totalWeightG().value.set(500);
    sheet['submit'](new Event('submit'));

    expect(emitted).toEqual([]);
  });

  it('drops a removed ingredient and rescales the preview', () => {
    const fixture = mount({ ...shopska, ingredients: [tomato, sirene] });
    const sheet = fixture.componentInstance;
    expect(sheet['derived']().totalWeightG).toBe(300);

    const key = sheet['ingredients']()[0]!.key;
    sheet['removeIngredient'](key);

    expect(sheet['ingredients']()).toHaveLength(1);
    expect(sheet['derived']().totalWeightG).toBe(100);
    expect(sheet['derived']().totals.kcal).toBeCloseTo(260, 5);
  });
});
