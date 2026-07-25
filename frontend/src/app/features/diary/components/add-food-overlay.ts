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
import { catchError, debounceTime, distinctUntilChanged, map, of, startWith, switchMap } from 'rxjs';

import { I18n } from '../../../core/i18n/i18n';
import type { TranslationKey } from '../../../core/i18n/translations';
import { macrosOf, round, round1 } from '../../../shared/utils/nutrition.utils';
import { Icon, type IconName } from '../../../shared/ui/icon';
import { FoodSearchApi } from '../data/food-search.api';
import {
  MEAL_LABEL_KEYS,
  MEAL_ORDER,
  type FoodSource,
  type LogEntry,
  type MealType,
} from '../models/diary.models';
import type { FoodSearchResult } from '../models/food-search.models';
import { BarcodeScannerOverlay } from './barcode-scanner-overlay';

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

// The Add-Food method chips. Search and scan are live; the rest render disabled until
// their flows are built.
interface AddFoodMode {
  key: string;
  icon: IconName;
  labelKey: TranslationKey;
  enabled: boolean;
}

const MODES: readonly AddFoodMode[] = [
  { key: 'search', icon: 'search', labelKey: 'addFood.modeSearch', enabled: true },
  { key: 'scan', icon: 'scan', labelKey: 'addFood.modeScan', enabled: true },
  { key: 'myfoods', icon: 'apple', labelKey: 'nav.myFoods', enabled: false },
  { key: 'recipes', icon: 'book', labelKey: 'nav.recipes', enabled: false },
  { key: 'photo', icon: 'sparkles', labelKey: 'addFood.modePhoto', enabled: false },
  { key: 'manual', icon: 'keyboard', labelKey: 'addFood.modeManual', enabled: false },
];

// Full-screen Add-Food overlay (z 55, above meal detail): method chips + debounced
// Open Food Facts search, then a portion step (meal switcher, grams stepper, live
// preview). Presentational like the other diary overlays — logging is emitted up.
@Component({
  selector: 'ct-add-food-overlay',
  imports: [Icon, BarcodeScannerOverlay],
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
        <div class="title">{{ i18n.t('diary.addFood') }}</div>
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
          <div class="sel-name">{{ sel.name }}</div>
          <div class="text-muted sel-meta">{{ resultMeta(sel) }}</div>

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
              <div>{{ i18n.t('diary.protein') }}&nbsp;{{ round1(preview().protein) }} g</div>
              <div>{{ i18n.t('diary.carbs') }}&nbsp;{{ round1(preview().carbs) }} g</div>
              <div>{{ i18n.t('diary.fat') }}&nbsp;{{ round1(preview().fat) }} g</div>
            </div>
          </div>
        </div>
        <div class="foot">
          <button class="btn btn-primary confirm" type="button" (click)="confirm()">
            <ct-icon name="check" />
            {{ i18n.t('addFood.logFood') }}
          </button>
        </div>
      } @else {
        <div class="chips">
          @for (mode of modes; track mode.key) {
            <button
              class="chip"
              type="button"
              [class.active]="mode.key === 'search'"
              [disabled]="!mode.enabled"
              [attr.title]="mode.enabled ? null : i18n.t('common.comingSoon')"
              (click)="onModeClick(mode)"
            >
              <ct-icon [name]="mode.icon" [size]="16" />
              {{ i18n.t(mode.labelKey) }}
            </button>
          }
        </div>

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
              <div class="text-muted note">{{ i18n.t('addFood.minChars', { n: minQuery }) }}</div>
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
                    <span class="result-name">{{ result.name }}</span>
                    <span class="text-muted result-meta">{{ resultMeta(result) }}</span>
                  </span>
                  <ct-icon class="result-chevron" name="chevron-right" [size]="18" />
                </button>
              }
            }
          }
        </div>
      }

      @if (scannerOpen()) {
        <ct-barcode-scanner-overlay (found)="onScanFound($event)" (close)="closeScanner()" />
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
    .head .btn-icon { border: 1px solid var(--color-divider); }
    .title {
      font-family: var(--font-heading);
      font-weight: 800;
      font-size: 16px;
      margin-right: auto;
    }

    .chips {
      flex: none;
      display: flex;
      gap: var(--space-2);
      padding: var(--space-3);
      overflow-x: auto;
      border-bottom: 1px solid var(--color-divider);
    }
    .chip {
      display: flex;
      align-items: center;
      gap: 6px;
      flex: none;
      padding: 8px 15px;
      border-radius: 999px;
      font-family: var(--font-heading);
      font-weight: 800;
      font-size: 13px;
      border: 1px solid var(--color-divider);
      background: var(--color-bg);
      color: var(--color-text);
      cursor: pointer;
      white-space: nowrap;
    }
    .chip.active {
      background: var(--color-accent);
      color: var(--color-bg);
      border-color: var(--color-accent);
    }
    .chip:disabled { opacity: 0.45; cursor: default; }

    .body { flex: 1; overflow-y: auto; padding: var(--space-4); }

    .searchbox {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      background: var(--color-surface);
      border: 1px solid var(--color-divider);
      padding: 0 10px;
      border-radius: 12px;
      margin-bottom: var(--space-4);
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    /* The field is borderless inside the box, so the focus ring belongs on the box
       (wrapping icon + input), not the inner input. */
    .searchbox:focus-within {
      border-color: var(--color-accent);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 22%, transparent);
    }
    .search-icon { opacity: 0.5; }
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

    .note { font-size: 13px; padding: var(--space-4) 0; }
    .spinner {
      width: 44px;
      height: 44px;
      border: 3px solid var(--color-divider);
      border-top-color: var(--color-accent);
      border-radius: 50%;
      margin: var(--space-6) auto;
      animation: ct-af-spin 0.8s linear infinite;
    }
    @keyframes ct-af-spin { to { transform: rotate(360deg); } }

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

    .sel-name { font-family: var(--font-heading); font-weight: 800; font-size: 22px; }
    .sel-meta { font-size: 13px; margin-bottom: var(--space-6); }

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
    .seg.active { background: var(--color-accent); color: var(--color-bg); }

    .stepper {
      display: flex;
      align-items: stretch;
      gap: var(--space-2);
      margin-bottom: var(--space-6);
    }
    .step { width: 48px; }
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
    .preview-top { display: flex; align-items: baseline; gap: var(--space-2); }
    .preview-kcal { font-family: var(--font-heading); font-weight: 800; font-size: 38px; line-height: 1; }
    .preview-label {
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      opacity: 0.7;
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

    .foot {
      flex: none;
      padding: var(--space-3) var(--space-4);
      border-top: 2px solid var(--color-divider);
    }
    .confirm { width: 100%; justify-content: center; padding: var(--space-3); }
  `,
})
export class AddFoodOverlay {
  protected readonly i18n = inject(I18n);
  private readonly api = inject(FoodSearchApi);
  protected readonly round = round;
  protected readonly round1 = round1;
  protected readonly modes = MODES;
  protected readonly mealOrder = MEAL_ORDER;
  protected readonly mealLabelKeys = MEAL_LABEL_KEYS;
  protected readonly minQuery = MIN_QUERY_LENGTH;

  /** The meal whose "+" opened the overlay — the portion step's default target. */
  readonly meal = input.required<MealType>();

  readonly close = output<void>();
  readonly log = output<Omit<LogEntry, 'id'>>();

  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  protected readonly queryText = signal('');
  private readonly retryTick = signal(0);
  protected readonly selected = signal<FoodSearchResult | null>(null);
  protected readonly grams = signal(100);
  protected readonly targetMeal = linkedSignal(() => this.meal());
  protected readonly scannerOpen = signal(false);

  // How the current `selected` food was picked — logged as the entry's source so a barcode
  // scan is distinguishable from a text-search pick.
  private readonly selectedSource = signal<FoodSource>('search');

  // Session cache: settled query → mapped results. Serves repeats (and back-and-forth
  // typing) without re-hitting OFF. Errors are not cached, so retry re-requests.
  private readonly cache = new Map<string, FoodSearchResult[]>();

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
      distinctUntilChanged(
        (a, b) => a.query === b.query && a.lang === b.lang && a.tick === b.tick,
      ),
      switchMap(({ query, lang }) => {
        if (query.length < MIN_QUERY_LENGTH) return of<SearchState>({ status: 'idle' });
        const cacheKey = `${lang}:${query.toLowerCase()}`;
        const cached = this.cache.get(cacheKey);
        if (cached) return of(toState(cached));
        return this.api.search(query, lang).pipe(
          map((results) => {
            this.cache.set(cacheKey, results);
            return toState(results);
          }),
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

  protected readonly preview = computed(() => {
    const sel = this.selected();
    return sel
      ? macrosOf({ ...sel, grams: this.grams() })
      : { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  });

  constructor() {
    afterNextRender(() => this.searchInput()?.nativeElement.focus());
  }

  protected resultMeta(result: FoodSearchResult): string {
    const brand = result.brand ?? this.i18n.t('addFood.generic');
    return `${brand} · ${round(result.kcalPer100g)} ${this.i18n.t('entry.kcalPer100')}`;
  }

  protected onQueryInput(event: Event): void {
    this.queryText.set((event.target as HTMLInputElement).value);
  }

  protected retry(): void {
    this.retryTick.update((tick) => tick + 1);
  }

  protected onModeClick(mode: AddFoodMode): void {
    if (mode.key === 'scan') this.scannerOpen.set(true);
  }

  protected closeScanner(): void {
    this.scannerOpen.set(false);
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
    this.selectedSource.set('search');
    this.selected.set(result);
    this.grams.set(100);
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
    this.log.emit({
      mealType: this.targetMeal(),
      name: sel.name,
      brand: sel.brand,
      source: this.selectedSource(),
      // The OFF barcode/product code — provenance for both search picks and scans.
      externalId: sel.code,
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
