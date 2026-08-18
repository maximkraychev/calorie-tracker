import {
  afterNextRender,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  map,
  of,
  startWith,
  switchMap,
} from 'rxjs';

import { I18n } from '../../../core/i18n/i18n';
import type { TranslationKey } from '../../../core/i18n/translations';
import { macrosOf, round, round1 } from '../../../shared/utils/nutrition.utils';
import { Icon, type IconName } from '../../../shared/ui/icon';
import { FoodsStore } from '../../foods/data/foods.store';
import { filterFoods, type CustomFood } from '../../foods/models/custom-food.models';
import { RecipesStore } from '../../recipes/data/recipes.store';
import {
  filterRecipes,
  type NewRecipeIngredient,
  type Recipe,
} from '../../recipes/models/recipe.models';
import { FoodCatalogSearch } from '../data/food-catalog.search';
import {
  MEAL_LABEL_KEYS,
  MEAL_ORDER,
  type AddFoodPurpose,
  type FoodSource,
  type LogEntry,
  type MealType,
} from '../models/diary.models';
import { displayName, type FoodSearchResult } from '../models/food-search.models';
import { BarcodeScannerOverlay } from './barcode-scanner-overlay';
import { ManualEntryPane } from './manual-entry-pane';
import { PhotoEstimateOverlay } from './photo-estimate-overlay';

// Open Food Facts asks clients not to hammer their search (rate-limited per IP), so
// queries only fire after a typing pause, never for under 3 characters, and repeats
// are served from the in-session cache below.
const DEBOUNCE_MS = 500;
const MIN_QUERY_LENGTH = 3;

type SearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'results'; results: FoodSearchResult[] }
  | { status: 'empty' }
  | { status: 'error' };

// The Add-Food method chips. All six are live; `enabled` stays because it is what a
// newly-added, not-yet-built method would set.
interface AddFoodMode {
  key: string;
  icon: IconName;
  labelKey: TranslationKey;
  enabled: boolean;
}

const MODES: readonly AddFoodMode[] = [
  { key: 'search', icon: 'search', labelKey: 'addFood.modeSearch', enabled: true },
  { key: 'scan', icon: 'scan', labelKey: 'addFood.modeScan', enabled: true },
  { key: 'myfoods', icon: 'apple', labelKey: 'nav.myFoods', enabled: true },
  { key: 'recipes', icon: 'book', labelKey: 'nav.recipes', enabled: true },
  { key: 'photo', icon: 'sparkles', labelKey: 'addFood.modePhoto', enabled: true },
  { key: 'manual', icon: 'keyboard', labelKey: 'addFood.modeManual', enabled: true },
];

// The chips that swap the overlay's browse pane. Scan and photo open their own overlays
// instead, so they are not modes in this sense.
type BrowseMode = 'search' | 'myfoods' | 'recipes' | 'manual';

const PICK_HIDDEN_MODES: readonly string[] = ['recipes', 'photo'];

// Full-screen Add-Food overlay (z 55, above meal detail): method chips + debounced
// Open Food Facts search, then a portion step (meal switcher, grams stepper, live
// preview). Presentational like the other diary overlays — logging is emitted up.
@Component({
  selector: 'ct-add-food-overlay',
  imports: [Icon, BarcodeScannerOverlay, ManualEntryPane, PhotoEstimateOverlay],
  template: `
    <div class="overlay">
      <header class="head">
        @if (selected()) {
          <button
            class="btn btn-icon"
            type="button"
            [attr.aria-label]="i18n.t('diary.back')"
            (click)="backToResults()"
          >
            <ct-icon name="arrow-left" />
          </button>
        }
        <div class="title">
          {{ i18n.t(purpose() === 'pick' ? 'recipes.addIngredient' : 'diary.addFood') }}
        </div>
        <button
          class="btn btn-icon"
          type="button"
          [attr.aria-label]="i18n.t('account.close')"
          (click)="close.emit()"
        >
          <ct-icon name="x" />
        </button>
      </header>

      @if (selected(); as sel) {
        <div class="body">
          <div class="sel-head">
            <!-- Open Food Facts products carry a front-of-pack photo; our own catalogs
                 don't, so the header falls back to plain text when there is none. -->
            @if (sel.imageUrl && !imageFailed()) {
              <img
                class="sel-image"
                [src]="sel.imageUrl"
                alt=""
                decoding="async"
                (error)="imageFailed.set(true)"
              />
            }
            <div>
              <div class="sel-name">{{ sel.name }}</div>
              <div class="text-muted sel-meta">{{ resultMeta(sel) }}</div>
            </div>
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

          <label class="field-label" for="af-grams">{{ i18n.t('entry.portionGrams') }}</label>
          <div class="stepper">
            <button
              class="btn btn-secondary step"
              type="button"
              [attr.aria-label]="i18n.t('entry.decreaseGrams')"
              (click)="addGrams(-10)"
            >
              −
            </button>
            <input
              id="af-grams"
              class="input grams"
              type="number"
              inputmode="numeric"
              min="0"
              [value]="grams()"
              (input)="onGramsInput($event)"
            />
            <button
              class="btn btn-secondary step"
              type="button"
              [attr.aria-label]="i18n.t('entry.increaseGrams')"
              (click)="addGrams(10)"
            >
              +
            </button>
          </div>

          <div class="preview">
            <div class="preview-top">
              <span class="preview-kcal">{{ round(preview().kcal) }}</span>
              <span class="preview-label">{{ i18n.t('diary.kcal') }}</span>
            </div>
            <div class="preview-macros">
              <div class="macro-carbs macro-pill">
                {{ i18n.t('diary.carbs') }} {{ round1(preview().carbs) }} g
              </div>
              <div class="macro-protein macro-pill">
                {{ i18n.t('diary.protein') }} {{ round1(preview().protein) }} g
              </div>
              <div class="macro-fat macro-pill">
                {{ i18n.t('diary.fat') }} {{ round1(preview().fat) }} g
              </div>
            </div>
          </div>
        </div>
        <div class="foot">
          <button class="btn btn-primary confirm" type="button" (click)="confirm()">
            <ct-icon name="check" />
            {{ i18n.t(purpose() === 'pick' ? 'recipes.addIngredient' : 'addFood.logFood') }}
          </button>
        </div>
      } @else {
        <div class="chips">
          @for (mode of modes(); track mode.key) {
            <button
              class="chip"
              type="button"
              [class.active]="mode.key === browseMode()"
              [disabled]="!mode.enabled"
              [attr.title]="mode.enabled ? null : i18n.t('common.comingSoon')"
              (click)="onModeClick(mode)"
            >
              <ct-icon [name]="mode.icon" [size]="16" />
              {{ i18n.t(mode.labelKey) }}
            </button>
          }
        </div>

        @if (browseMode() === 'search') {
          <div class="body">
            <div class="searchbox">
              <ct-icon class="search-icon" name="search" [size]="18" />
              <input
                #searchInput
                class="input query"
                type="text"
                enterkeyhint="search"
                [placeholder]="i18n.t('addFood.searchPlaceholder')"
                [attr.aria-label]="i18n.t('addFood.searchPlaceholder')"
                [value]="queryText()"
                (input)="onQueryInput($event)"
              />
            </div>

            @switch (search().status) {
              @case ('idle') {
                <div class="text-muted note">
                  {{ i18n.t('addFood.minChars', { n: minQuery }) }}
                </div>
              }
              @case ('loading') {
                <div
                  class="spinner"
                  role="status"
                  [attr.aria-label]="i18n.t('addFood.searching')"
                ></div>
              }
              @case ('empty') {
                <div class="text-muted note">{{ i18n.t('addFood.noMatches') }}</div>
              }
              @case ('error') {
                <div class="text-muted note">{{ i18n.t('addFood.error') }}</div>
                <button class="btn btn-secondary" type="button" (click)="retry()">
                  {{ i18n.t('addFood.retry') }}
                </button>
              }
              @case ('results') {
                @for (result of results(); track result.code) {
                  <button class="result" type="button" (click)="pick(result)">
                    <span class="result-text">
                      <span class="result-name">{{ resultName(result) }}</span>
                      <span class="text-muted result-meta">{{ resultMeta(result) }}</span>
                    </span>
                    <ct-icon class="result-chevron" name="chevron-right" [size]="18" />
                  </button>
                }
              }
            }
          </div>
        } @else if (browseMode() === 'myfoods') {
          <div class="body">
            @switch (foods.status()) {
              @case ('loading') {
                <div
                  class="spinner"
                  role="status"
                  [attr.aria-label]="i18n.t('myFoods.loading')"
                ></div>
              }
              @case ('error') {
                <div class="text-muted note">{{ i18n.t('myFoods.loadError') }}</div>
                <button class="btn btn-secondary" type="button" (click)="foods.reload()">
                  {{ i18n.t('diary.retry') }}
                </button>
              }
              @case ('ready') {
                @if (foods.foods().length === 0) {
                  <div class="text-muted note">{{ i18n.t('myFoods.emptyBody') }}</div>
                } @else {
                  <div class="searchbox">
                    <ct-icon class="search-icon" name="search" [size]="18" />
                    <input
                      class="input query"
                      type="text"
                      enterkeyhint="search"
                      [placeholder]="i18n.t('myFoods.searchPlaceholder')"
                      [attr.aria-label]="i18n.t('myFoods.searchPlaceholder')"
                      [value]="myFoodsQuery()"
                      (input)="onMyFoodsQueryInput($event)"
                    />
                  </div>

                  @if (myFoods().length === 0) {
                    <div class="text-muted note">{{ i18n.t('myFoods.noMatches') }}</div>
                  } @else {
                    @for (food of myFoods(); track food.id) {
                      <button class="result" type="button" (click)="pickCustom(food)">
                        <span class="result-text">
                          <span class="result-name">{{ food.name }}</span>
                          <span class="text-muted result-meta">{{ customMeta(food) }}</span>
                        </span>
                        <ct-icon class="result-chevron" name="chevron-right" [size]="18" />
                      </button>
                    }
                  }
                }
              }
            }
          </div>
        } @else if (browseMode() === 'recipes') {
          <!-- Recipes: browsed and filtered client-side, exactly like My Foods above. -->
          <div class="body">
            @switch (recipesStore.status()) {
              @case ('loading') {
                <div
                  class="spinner"
                  role="status"
                  [attr.aria-label]="i18n.t('recipes.loading')"
                ></div>
              }
              @case ('error') {
                <div class="text-muted note">{{ i18n.t('recipes.loadError') }}</div>
                <button class="btn btn-secondary" type="button" (click)="recipesStore.reload()">
                  {{ i18n.t('diary.retry') }}
                </button>
              }
              @case ('ready') {
                @if (recipesStore.recipes().length === 0) {
                  <div class="text-muted note">{{ i18n.t('recipes.emptyBody') }}</div>
                } @else {
                  <div class="searchbox">
                    <ct-icon class="search-icon" name="search" [size]="18" />
                    <input
                      class="input query"
                      type="text"
                      enterkeyhint="search"
                      [placeholder]="i18n.t('recipes.searchPlaceholder')"
                      [attr.aria-label]="i18n.t('recipes.searchPlaceholder')"
                      [value]="recipesQuery()"
                      (input)="onRecipesQueryInput($event)"
                    />
                  </div>

                  @if (recipes().length === 0) {
                    <div class="text-muted note">{{ i18n.t('recipes.noMatches') }}</div>
                  } @else {
                    @for (recipe of recipes(); track recipe.id) {
                      <button class="result" type="button" (click)="pickRecipe(recipe)">
                        <span class="result-text">
                          <span class="result-name">{{ recipe.name }}</span>
                          <span class="text-muted result-meta">{{ recipeMeta(recipe) }}</span>
                        </span>
                        <ct-icon class="result-chevron" name="chevron-right" [size]="18" />
                      </button>
                    }
                  }
                }
              }
            }
          </div>
        } @else {
          <!-- Manual: a self-contained form, so it emits the finished entry itself rather
               than handing a food to the portion step above. -->
          <ct-manual-entry-pane
            [purpose]="purpose()"
            [meal]="meal()"
            (log)="log.emit($event)"
            (pickIngredient)="pickIngredient.emit($event)"
          />
        }
      }

      @if (scannerOpen()) {
        <ct-barcode-scanner-overlay (found)="onScanFound($event)" (close)="closeScanner()" />
      }

      @if (photoOpen()) {
        <ct-photo-estimate-overlay
          [meal]="targetMeal()"
          (log)="logMany.emit($event)"
          (close)="closePhoto()"
        />
      }
    </div>
  `,
  styles: `
    .overlay {
      position: absolute;
      inset: 0;
      z-index: 55;
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

    /* Two fixed rows of three (search / scan / my foods, then recipes / photo / manual)
       instead of one horizontally scrolling row, which pushed the later methods off-screen
       and made them easy to miss. Every method is visible and tappable without scrolling. */
    .chips {
      flex: none;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: var(--space-2);
      padding: var(--space-3);
      border-bottom: 1px solid var(--color-divider);
    }
    .chip {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      min-width: 0;
      padding: 9px 8px;
      border-radius: 999px;
      font-family: var(--font-heading);
      font-weight: 800;
      font-size: 12px;
      line-height: 1.2;
      text-align: center;
      border: 1px solid var(--color-divider);
      background: var(--color-bg);
      color: var(--color-text);
      cursor: pointer;
    }
    /* The label may wrap to a second line in a narrow column (Bulgarian "Моите храни");
       the icon must not shrink when it does. */
    .chip ct-icon {
      flex: none;
    }
    .chip.active {
      background: var(--color-accent);
      color: var(--color-bg);
      border-color: var(--color-accent);
    }
    .chip:disabled {
      opacity: 0.45;
      cursor: default;
    }

    .body {
      flex: 1;
      overflow-y: auto;
      padding: var(--space-4);
    }

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
    .search-icon {
      opacity: 0.5;
    }
    .query {
      flex: 1;
      border: 0;
      background: transparent;
      padding-left: 0;
    }
    /* Suppress the global .input focus ring on the inner field (higher specificity wins). */
    .searchbox .query:focus-visible {
      outline: none;
      border: 0;
      box-shadow: none;
    }

    .note {
      font-size: 13px;
      padding: var(--space-4) 0;
    }
    .spinner {
      width: 44px;
      height: 44px;
      border: 3px solid var(--color-divider);
      border-top-color: var(--color-accent);
      border-radius: 50%;
      margin: var(--space-6) auto;
      animation: ct-af-spin 0.8s linear infinite;
    }
    @keyframes ct-af-spin {
      to {
        transform: rotate(360deg);
      }
    }

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
    .result-text {
      flex: 1;
      min-width: 0;
    }
    .result-name {
      display: block;
      font-weight: 600;
      font-size: 15px;
    }
    .result-meta {
      display: block;
      font-size: 12px;
    }
    .result-chevron {
      opacity: 0.4;
    }

    .sel-head {
      margin-bottom: var(--space-6);
    }
    /* With a photo the header stacks and centers — picture on top, name and kcal under
       it. Without one (our own foods and recipes carry no image) it stays the plain
       left-aligned title it has always been, so those picks look unchanged. */
    .sel-head:has(.sel-image) {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-3);
      text-align: center;
    }
    /* Product shots come on every conceivable background and aspect ratio, so the tile
       brings its own surface, and object-fit: contain shows tall packaging uncropped. */
    .sel-image {
      width: 120px;
      height: 120px;
      object-fit: contain;
      background: var(--color-surface);
      border: 1px solid var(--color-divider);
      border-radius: var(--radius-lg);
    }
    .sel-name {
      font-family: var(--font-heading);
      font-weight: 800;
      font-size: 22px;
    }
    .sel-meta {
      font-size: 13px;
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

    .stepper {
      display: flex;
      align-items: stretch;
      gap: var(--space-2);
      margin-bottom: var(--space-6);
    }
    .step {
      width: 48px;
    }
    .grams {
      text-align: center;
      font-family: var(--font-heading);
      font-weight: 800;
      font-size: 20px;
    }

    .preview {
      background: var(--color-surface);
      color: var(--color-text);
      border: 1px solid var(--color-divider);
      border-radius: 18px;
      padding: var(--space-4);
      margin-bottom: var(--space-4);
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
    .preview-macros {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      margin-top: var(--space-3);
      border-top: 1px solid var(--color-divider);
      padding-top: var(--space-3);
      font-size: 13px;
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
export class AddFoodOverlay {
  protected readonly i18n = inject(I18n);
  // Both food catalogs behind one call — shared with the photo estimate's
  // add-ingredient field so the two searches can never drift apart.
  private readonly catalog = inject(FoodCatalogSearch);
  // Root-provided, so the catalog the My Foods page already loaded is reused here.
  protected readonly foods = inject(FoodsStore);
  // Same deal for recipes — the Recipes tab and this pane share one loaded copy.
  protected readonly recipesStore = inject(RecipesStore);
  protected readonly round = round;
  protected readonly round1 = round1;
  protected readonly mealOrder = MEAL_ORDER;
  protected readonly mealLabelKeys = MEAL_LABEL_KEYS;
  protected readonly minQuery = MIN_QUERY_LENGTH;

  /** Log a diary entry, or pick an ingredient for a recipe. */
  readonly purpose = input<AddFoodPurpose>('log');

  /**
   * The meal whose "+" opened the overlay — the portion step's default target.
   *
   * Null in 'pick' mode, where there is no meal in play at all.
   */
  readonly meal = input<MealType | null>(null);

  readonly close = output<void>();
  readonly log = output<Omit<LogEntry, 'id'>>();
  /** A whole meal at once — the photo estimate resolves several ingredients per photo. */
  readonly logMany = output<Omit<LogEntry, 'id'>[]>();
  /** 'pick' mode's answer: the chosen food as a recipe ingredient. */
  readonly pickIngredient = output<NewRecipeIngredient>();

  protected readonly modes = computed(() =>
    this.purpose() === 'pick'
      ? MODES.filter((mode) => !PICK_HIDDEN_MODES.includes(mode.key))
      : MODES,
  );

  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  protected readonly queryText = signal('');
  /** Which browse pane the chips have selected. */
  protected readonly browseMode = signal<BrowseMode>('search');
  // Separate queries from the database search, so switching chips back and forth keeps
  // every filter — they search entirely different things.
  protected readonly myFoodsQuery = signal('');
  protected readonly recipesQuery = signal('');
  private readonly retryTick = signal(0);
  protected readonly selected = signal<FoodSearchResult | null>(null);
  // An OFF image URL can outlive the photo it points at (products are community-edited,
  // and the record we read may be cached). A broken-image icon is worse than no image, so
  // a failed load hides the tile — reset on every new pick.
  protected readonly imageFailed = linkedSignal({
    source: this.selected,
    computation: () => false,
  });
  protected readonly grams = signal(100);
  // Falls back to the first meal only in 'pick' mode, where no meal is supplied and the
  // switcher is hidden — nothing downstream reads it there.
  protected readonly targetMeal = linkedSignal<MealType>(() => this.meal() ?? MEAL_ORDER[0]!);
  protected readonly scannerOpen = signal(false);
  protected readonly photoOpen = signal(false);

  // How the current `selected` food was picked — logged as the entry's source so a barcode
  // scan is distinguishable from a text-search pick.
  private readonly selectedSource = signal<FoodSource>('search');

  private readonly searchKey = computed(() => ({
    query: this.queryText().trim(),
    lang: this.i18n.lang(),
    tick: this.retryTick(),
  }));

  // Debounced search pipeline. `switchMap` drops in-flight requests when the query
  // changes; `startWith` flips the UI to loading only for real (uncached) requests.
  protected readonly search = toSignal(
    toObservable(this.searchKey).pipe(
      debounceTime(DEBOUNCE_MS),
      distinctUntilChanged((a, b) => a.query === b.query && a.lang === b.lang && a.tick === b.tick),
      switchMap(({ query, lang }) => {
        if (query.length < MIN_QUERY_LENGTH) return of<SearchState>({ status: 'idle' });
        return this.catalog.search(query, lang).pipe(
          map(toState),
          catchError(() => of<SearchState>({ status: 'error' })),
          startWith<SearchState>({ status: 'loading' }),
        );
      }),
    ),
    { initialValue: { status: 'idle' } as SearchState },
  );

  protected readonly results = computed<FoodSearchResult[]>(() => {
    const state = this.search();
    return state.status === 'results' ? state.results : [];
  });

  /** The user's own catalog, narrowed by this pane's own filter box. */
  protected readonly myFoods = computed(() => filterFoods(this.foods.foods(), this.myFoodsQuery()));

  /** The user's own recipes, narrowed by this pane's own filter box. */
  protected readonly recipes = computed(() =>
    filterRecipes(this.recipesStore.recipes(), this.recipesQuery()),
  );

  protected readonly preview = computed(() => {
    const sel = this.selected();
    return sel
      ? macrosOf({ ...sel, grams: this.grams() })
      : { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  });

  constructor() {
    afterNextRender(() => this.searchInput()?.nativeElement.focus());
  }

  /** The result's name in the active language — generic foods carry a Bulgarian one. */
  protected resultName(result: FoodSearchResult): string {
    return displayName(result, this.i18n.lang());
  }

  protected resultMeta(result: FoodSearchResult): string {
    // "Generic" is the right label for an unbranded database hit, but a custom food has
    // no brand because the user didn't give it one — say whose it is instead.
    const fallback = result.source === 'custom' ? 'myFoods.customLabel' : 'addFood.generic';
    const brand = result.brand ?? this.i18n.t(fallback);
    return `${brand} · ${round(result.kcalPer100g)} ${this.i18n.t('entry.kcalPer100')}`;
  }

  protected customMeta(food: CustomFood): string {
    const brand = food.brand ?? this.i18n.t('myFoods.customLabel');
    return `${brand} · ${round(food.kcalPer100g)} ${this.i18n.t('entry.kcalPer100')}`;
  }

  // The whole-dish weight, because that is the portion the grams stepper starts on.
  protected recipeMeta(recipe: Recipe): string {
    return `${round(recipe.totalWeightG)} g · ${round(recipe.kcalPer100g)} ${this.i18n.t('entry.kcalPer100')}`;
  }

  protected onQueryInput(event: Event): void {
    this.queryText.set((event.target as HTMLInputElement).value);
  }

  protected onMyFoodsQueryInput(event: Event): void {
    this.myFoodsQuery.set((event.target as HTMLInputElement).value);
  }

  protected onRecipesQueryInput(event: Event): void {
    this.recipesQuery.set((event.target as HTMLInputElement).value);
  }

  protected retry(): void {
    this.retryTick.update((tick) => tick + 1);
  }

  protected onModeClick(mode: AddFoodMode): void {
    if (mode.key === 'scan') this.scannerOpen.set(true);
    else if (mode.key === 'photo') this.photoOpen.set(true);
    else if (
      mode.key === 'search' ||
      mode.key === 'myfoods' ||
      mode.key === 'recipes' ||
      mode.key === 'manual'
    ) {
      this.browseMode.set(mode.key);
      // Deferred to the first open of each pane, so an Add-Food that only ever searches
      // requests neither list.
      if (mode.key === 'myfoods') this.foods.ensureLoaded();
      if (mode.key === 'recipes') this.recipesStore.ensureLoaded();
    }
  }

  protected closeScanner(): void {
    this.scannerOpen.set(false);
  }

  protected closePhoto(): void {
    this.photoOpen.set(false);
  }

  // A scanned barcode resolved to an OFF product: close the camera and drop straight into
  // the portion step, the same place a search pick lands.
  protected onScanFound(result: FoodSearchResult): void {
    this.scannerOpen.set(false);
    this.selectedSource.set('barcode');
    this.selected.set(result);
    this.grams.set(100);
  }

  protected pick(result: FoodSearchResult): void {
    // The result carries its own provenance — a USDA catalog hit is 'generic', not the
    // 'search' every pick used to be labelled.
    this.selectedSource.set(result.source);
    this.selected.set(result);
    this.grams.set(100);
  }

  // A custom food enters the same portion step as any other pick: mapped onto
  // FoodSearchResult, everything downstream (preview, meal switcher, grams) is unchanged.
  protected pickCustom(food: CustomFood): void {
    this.selectedSource.set('custom');
    this.selected.set({
      code: `custom:${food.id}`,
      name: food.name,
      brand: food.brand,
      source: 'custom',
      customFoodId: food.id,
      servingSizeG: food.servingSizeG,
      kcalPer100g: food.kcalPer100g,
      proteinPer100g: food.proteinPer100g,
      carbsPer100g: food.carbsPer100g,
      fatPer100g: food.fatPer100g,
    });
    // The user recorded a serving size for exactly this reason — start there.
    this.grams.set(food.servingSizeG ?? 100);
  }

  // A recipe enters the same portion step as any other pick, mapped onto the shared
  // result shape. `recipeId` is what the diary POST will send instead of the nutrition
  // below — that copy only renders the preview and the optimistic row.
  protected pickRecipe(recipe: Recipe): void {
    this.selectedSource.set('recipe');
    this.selected.set({
      code: `recipe:${recipe.id}`,
      name: recipe.name,
      brand: null,
      source: 'recipe',
      recipeId: recipe.id,
      servingSizeG: recipe.totalWeightG,
      kcalPer100g: recipe.kcalPer100g,
      proteinPer100g: recipe.proteinPer100g,
      carbsPer100g: recipe.carbsPer100g,
      fatPer100g: recipe.fatPer100g,
    });
    // The whole dish, which the user then dials down to the portion they actually ate.
    this.grams.set(recipe.totalWeightG);
  }

  protected backToResults(): void {
    this.selected.set(null);
  }

  protected addGrams(delta: number): void {
    this.grams.update((grams) => Math.max(0, grams + delta));
  }

  protected onGramsInput(event: Event): void {
    const value = parseFloat((event.target as HTMLInputElement).value);
    this.grams.set(Number.isFinite(value) && value >= 0 ? value : 0);
  }

  protected confirm(): void {
    const sel = this.selected();
    if (!sel || this.grams() <= 0) return;
    const source = this.selectedSource();
    const isCustom = source === 'custom';
    const isRecipe = source === 'recipe';

    if (this.purpose() === 'pick') {
      this.pickIngredient.emit({
        name: sel.name,
        brand: sel.brand,
        // 'recipe' is unreachable here: the recipes chip is hidden in pick mode, because
        // recipes do not nest.
        source: isCustom ? 'custom' : (source as 'search' | 'generic' | 'barcode' | 'manual'),
        customFoodId: isCustom ? (sel.customFoodId ?? null) : null,
        externalId: isCustom ? null : sel.code,
        grams: this.grams(),
        kcalPer100g: sel.kcalPer100g,
        proteinPer100g: sel.proteinPer100g,
        carbsPer100g: sel.carbsPer100g,
        fatPer100g: sel.fatPer100g,
      });
      return;
    }

    this.log.emit({
      mealType: this.targetMeal(),
      name: sel.name,
      brand: sel.brand,
      source,
      // The OFF barcode / USDA id — provenance for search picks and scans. A custom food
      // or a recipe has no external identity; it carries `customFoodId` / `recipeId`
      // instead, and that is all the API is sent: the nutrition below is only here to
      // render the optimistic row until the server's own snapshot comes back.
      externalId: isCustom || isRecipe ? null : sel.code,
      customFoodId: isCustom ? (sel.customFoodId ?? null) : null,
      recipeId: isRecipe ? (sel.recipeId ?? null) : null,
      grams: this.grams(),
      kcalPer100g: sel.kcalPer100g,
      proteinPer100g: sel.proteinPer100g,
      carbsPer100g: sel.carbsPer100g,
      fatPer100g: sel.fatPer100g,
    });
  }
}

function toState(results: FoodSearchResult[]): SearchState {
  return results.length > 0 ? { status: 'results', results } : { status: 'empty' };
}
