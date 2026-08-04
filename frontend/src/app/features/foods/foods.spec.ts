import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { CustomFoodSheet } from './components/custom-food-sheet';
import { FoodsStore } from './data/foods.store';
import { filterFoods, type CustomFood, type NewCustomFood } from './models/custom-food.models';

const banitsa: CustomFood = {
  id: 'f1',
  name: 'Banitsa',
  brand: 'Homemade',
  servingSizeG: 150,
  kcalPer100g: 280,
  proteinPer100g: 8,
  carbsPer100g: 26,
  fatPer100g: 16,
};

const { id: _banitsaId, ...newBanitsa } = banitsa;

/** The same food as the API sends it — nutrition nested under `per100g`. */
function dto(food: CustomFood) {
  return {
    id: food.id,
    source: 'custom',
    externalId: null,
    name: food.name,
    brand: food.brand,
    servingSizeG: food.servingSizeG,
    per100g: {
      kcal: food.kcalPer100g,
      protein: food.proteinPer100g,
      carbs: food.carbsPer100g,
      fat: food.fatPer100g,
    },
  };
}

describe('filterFoods', () => {
  const foods: CustomFood[] = [banitsa, { ...banitsa, id: 'f2', name: 'Tarator', brand: null }];

  it('returns everything for a blank query', () => {
    expect(filterFoods(foods, '  ')).toHaveLength(2);
  });

  it('matches name and brand case-insensitively', () => {
    expect(filterFoods(foods, 'TARA').map((f) => f.id)).toEqual(['f2']);
    expect(filterFoods(foods, 'homemade').map((f) => f.id)).toEqual(['f1']);
  });

  it('tolerates a null brand', () => {
    expect(filterFoods(foods, 'zzz')).toEqual([]);
  });
});

describe('FoodsStore', () => {
  let store: FoodsStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(FoodsStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function load(foods: CustomFood[] = []): void {
    store.ensureLoaded();
    http.expectOne('/api/foods').flush(foods.map(dto));
  }

  it('loads once and flattens the wire per100g object', () => {
    load([banitsa]);
    expect(store.status()).toBe('ready');
    expect(store.foods()[0]).toEqual(banitsa);

    // A second caller must not re-request.
    store.ensureLoaded();
    http.expectNone('/api/foods');
  });

  it('reports a failed load so the page can offer a retry', () => {
    store.ensureLoaded();
    http.expectOne('/api/foods').error(new ProgressEvent('fail'));
    expect(store.status()).toBe('error');
  });

  it('shows a created food immediately and swaps in the server row', () => {
    load();
    store.create(newBanitsa);

    // Optimistic: visible before the POST resolves, under a temporary id.
    expect(store.foods()).toHaveLength(1);
    expect(store.foods()[0]!.id).toMatch(/^temp-/);

    const req = http.expectOne('/api/foods');
    expect(req.request.method).toBe('POST');
    // The wire body nests per100g; the flat model never leaks out.
    expect(req.request.body.per100g).toEqual({ kcal: 280, protein: 8, carbs: 26, fat: 16 });
    req.flush(dto(banitsa));

    expect(store.foods()).toEqual([banitsa]);
  });

  it('rolls the optimistic row back when the create fails', () => {
    load();
    store.create(newBanitsa);
    expect(store.foods()).toHaveLength(1);

    http.expectOne('/api/foods').error(new ProgressEvent('fail'));
    expect(store.foods()).toEqual([]);
  });

  it('restores the previous list when a delete fails', () => {
    load([banitsa]);
    store.remove('f1');
    expect(store.foods()).toEqual([]);

    http.expectOne('/api/foods/f1').error(new ProgressEvent('fail'));
    expect(store.foods()).toEqual([banitsa]);
  });

  it('ignores mutations on a row still awaiting its POST', () => {
    load();
    store.create(newBanitsa);
    const tempId = store.foods()[0]!.id;
    const create = http.expectOne('/api/foods');

    store.remove(tempId);
    store.update(tempId, newBanitsa);
    http.expectNone((req) => req.url.startsWith('/api/foods/'));

    create.flush(dto(banitsa));
  });
});

describe('CustomFoodSheet', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  });

  function mount(food: CustomFood | null) {
    const fixture = TestBed.createComponent(CustomFoodSheet);
    fixture.componentRef.setInput('food', food);
    fixture.detectChanges();
    return fixture;
  }

  it('starts blank for a new food, so numbers are null rather than zero', () => {
    const fixture = mount(null);
    const form = fixture.componentInstance['foodForm'];
    expect(form.name().value()).toBe('');
    expect(form.kcal().value()).toBeNull();
    // Empty numbers are invalid, not a silently-saved zero-calorie food.
    expect(form().invalid()).toBe(true);
  });

  it('seeds the draft from the food being edited', () => {
    const fixture = mount(banitsa);
    const form = fixture.componentInstance['foodForm'];
    expect(form.name().value()).toBe('Banitsa');
    expect(form.kcal().value()).toBe(280);
    expect(form.servingSizeG().value()).toBe(150);
    expect(form().invalid()).toBe(false);
  });

  it('rejects out-of-range nutrition, mirroring the DB CHECKs', () => {
    const fixture = mount(banitsa);
    const form = fixture.componentInstance['foodForm'];

    form.kcal().value.set(1200);
    expect(form.kcal().invalid()).toBe(true);
    form.kcal().value.set(280);
    expect(form.kcal().invalid()).toBe(false);

    form.protein().value.set(150);
    expect(form.protein().invalid()).toBe(true);
  });

  it('treats a null serving size as valid but a non-positive one as invalid', () => {
    const fixture = mount(banitsa);
    const form = fixture.componentInstance['foodForm'];

    form.servingSizeG().value.set(null);
    expect(form.servingSizeG().invalid()).toBe(false);

    form.servingSizeG().value.set(0);
    expect(form.servingSizeG().invalid()).toBe(true);
  });

  it('emits a trimmed model on submit and nothing at all when invalid', () => {
    const fixture = mount(banitsa);
    const sheet = fixture.componentInstance;
    const form = sheet['foodForm'];
    const emitted: NewCustomFood[] = [];
    sheet.save.subscribe((value) => emitted.push(value));

    form.name().value.set('  Banitsa  ');
    form.brand().value.set('   ');
    sheet['submit'](new Event('submit'));

    expect(emitted).toEqual([
      {
        name: 'Banitsa',
        // A whitespace-only brand is no brand.
        brand: null,
        servingSizeG: 150,
        kcalPer100g: 280,
        proteinPer100g: 8,
        carbsPer100g: 26,
        fatPer100g: 16,
      },
    ]);

    form.kcal().value.set(null);
    sheet['submit'](new Event('submit'));
    expect(emitted).toHaveLength(1);
  });
});
