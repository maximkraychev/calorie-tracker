import {
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  linkedSignal,
  output,
  signal,
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
import { Icon } from '../../../shared/ui/icon';
import { macrosOf, round, round1, sumMacros } from '../../../shared/utils/nutrition.utils';
import { FoodCatalogSearch } from '../data/food-catalog.search';
import { PhotoEstimateApi } from '../data/photo-estimate.api';
import { preparePhoto } from '../data/image-prep';
import { MEAL_LABEL_KEYS, MEAL_ORDER, type LogEntry, type MealType } from '../models/diary.models';
import { displayName, type FoodSearchResult } from '../models/food-search.models';
import type { EstimateItem } from '../models/photo-estimate.models';

// Open Food Facts rate-limits per IP, so the "add an ingredient" field waits for a
// typing pause and ignores near-empty queries — the same discipline, and the same
// numbers, as the Add-Food search it now shares a catalog with.
const DEBOUNCE_MS = 500;
const MIN_QUERY_LENGTH = 3;

const GRAMS_STEP = 10;

type Phase = 'capture' | 'working' | 'review' | 'error';

/**
 * One row in the review list. Rows the model produced carry no `picked`; rows the user
 * added from the food search carry the catalog hit they came from, because that — not
 * the photo — is where their nutrition and their provenance come from, and the diary
 * entry has to say so.
 */
type ReviewItem = EstimateItem & { picked?: FoodSearchResult };

/**
 * Photo → editable ingredient list → diary (z 60, opened from the Add-Food overlay).
 *
 * After the analysis returns, everything is local arithmetic: the response carries
 * per-100g values for every item, so changing grams or deleting a row never touches the
 * network. The add-ingredient search is the one exception, and only Confirm writes.
 */
@Component({
  selector: 'ct-photo-estimate-overlay',
  imports: [Icon],
  template: `
    <div class="overlay" role="dialog" aria-modal="true" [attr.aria-label]="i18n.t('photo.title')">
      <header class="head">
        @if (phase() === 'review') {
          <button
            class="btn btn-icon"
            type="button"
            [attr.aria-label]="i18n.t('diary.back')"
            (click)="backToCapture()"
          >
            <ct-icon name="arrow-left" />
          </button>
        }
        <div class="title">{{ i18n.t('photo.title') }}</div>
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
        @if (previewUrl(); as url) {
          <img class="preview-img" [src]="url" alt="" />
        }

        @switch (phase()) {
          @case ('capture') {
            <!-- Two inputs rather than one: the capture attribute is a request for the
                 camera, and a browser that honours it gives no way back to the gallery.
                 The only reliable way to offer both is to expose both. Same handler —
                 the picked file is read off the event target. -->
            <div class="pickers">
              <input
                id="ct-photo-camera"
                class="sr-only"
                type="file"
                accept="image/*"
                capture="environment"
                (change)="onFilePicked($event)"
              />
              <label class="btn btn-secondary picker" for="ct-photo-camera">
                <ct-icon name="camera" [size]="18" />
                {{ i18n.t('photo.takePhoto') }}
              </label>

              <input
                id="ct-photo-file"
                class="sr-only"
                type="file"
                accept="image/*"
                (change)="onFilePicked($event)"
              />
              <label class="btn btn-secondary picker" for="ct-photo-file">
                <ct-icon name="image" [size]="18" />
                {{ i18n.t('photo.fromGallery') }}
              </label>
            </div>

            @if (previewUrl()) {
              <p class="text-muted hint">{{ i18n.t('photo.retake') }}</p>
            }

            <label class="field-label" for="ct-photo-note">{{ i18n.t('photo.noteLabel') }}</label>
            <input
              id="ct-photo-note"
              class="input"
              type="text"
              [placeholder]="i18n.t('photo.notePlaceholder')"
              [value]="note()"
              (input)="onNoteInput($event)"
            />
            <p class="text-muted hint">{{ i18n.t('photo.noteHint') }}</p>
          }

          @case ('working') {
            <div class="spinner" role="status" [attr.aria-label]="i18n.t('photo.analyzing')"></div>
            <p class="text-muted note-line">{{ i18n.t(workingKey()) }}</p>
            <!-- Skeleton rows: the vision call takes a few seconds, and an empty screen
                 reads as a hang. -->
            @for (row of skeletonRows; track row) {
              <div class="skeleton"></div>
            }
          }

          @case ('error') {
            <p class="note-line">{{ i18n.t(errorKey()) }}</p>
            <button class="btn btn-secondary" type="button" (click)="backToCapture()">
              {{ i18n.t('photo.tryAgain') }}
            </button>
          }

          @case ('review') {
            @if (items().length === 0) {
              <p class="text-muted note-line">{{ i18n.t('photo.empty') }}</p>
            }

            @if (clarifyingQuestion(); as question) {
              <button class="clarify" type="button" (click)="answerQuestion()">
                <span>{{ question }}</span>
                <span class="clarify-cta">{{ i18n.t('photo.answer') }}</span>
              </button>
            }

            @if (hiddenFatsNote(); as fats) {
              <p class="text-muted note-line">{{ fats }}</p>
            }
            @if (scaleReference(); as reference) {
              <p class="text-muted note-line">
                {{ i18n.t('photo.scaleUsed', { reference }) }}
              </p>
            }

            <label class="field-label">{{ i18n.t('addFood.meal') }}</label>
            <div class="meal-seg">
              @for (mealOption of mealOrder; track mealOption) {
                <button
                  class="seg"
                  type="button"
                  [class.active]="targetMeal() === mealOption"
                  [attr.aria-pressed]="targetMeal() === mealOption"
                  (click)="targetMeal.set(mealOption)"
                >
                  {{ i18n.t(mealLabelKeys[mealOption]) }}
                </button>
              }
            </div>

            <h2 class="section-title">{{ i18n.t('photo.items') }}</h2>
            @for (item of items(); track item.id) {
              <div class="item">
                <div class="item-head">
                  <span class="item-name">{{ item.displayName }}</span>
                  <button
                    class="btn btn-icon"
                    type="button"
                    [attr.aria-label]="i18n.t('photo.remove') + ': ' + item.displayName"
                    (click)="removeItem(item.id)"
                  >
                    <ct-icon name="trash" [size]="16" />
                  </button>
                </div>

                <!-- Every item says where its macros came from, so a database fact and a
                     model guess are never mistaken for one another. -->
                <p class="source">
                  @if (item.unresolved) {
                    <span class="badge badge-ai">
                      <ct-icon name="sparkles" [size]="12" />
                      {{ i18n.t('photo.sourceAi') }}
                    </span>
                    {{ i18n.t('photo.unresolvedHint') }}
                  } @else {
                    <!-- Badge only: repeating the same sentence on every resolved row is
                         noise, so the explanation lives on the tooltip. -->
                    <span class="badge badge-db" [title]="i18n.t('photo.sourceDbHint')">
                      <ct-icon name="check" [size]="12" />
                      {{ i18n.t(sourceKey(item)) }}
                    </span>
                  }
                </p>

                <div class="stepper">
                  <button
                    class="btn btn-secondary step"
                    type="button"
                    [attr.aria-label]="i18n.t('entry.decreaseGrams') + ': ' + item.displayName"
                    (click)="addGrams(item.id, -gramsStep)"
                  >
                    −
                  </button>
                  <input
                    class="input grams"
                    type="number"
                    inputmode="numeric"
                    min="0"
                    [attr.aria-label]="i18n.t('entry.portionGrams') + ': ' + item.displayName"
                    [value]="item.grams"
                    (input)="onGramsInput(item.id, $event)"
                  />
                  <button
                    class="btn btn-secondary step"
                    type="button"
                    [attr.aria-label]="i18n.t('entry.increaseGrams') + ': ' + item.displayName"
                    (click)="addGrams(item.id, gramsStep)"
                  >
                    +
                  </button>
                </div>

                <div class="item-macros text-muted">
                  <span class="item-kcal"
                    >{{ round(macrosOf(item).kcal) }} {{ i18n.t('diary.kcal') }}</span
                  >
                  <span class="macro-carbs macro-pill">
                    {{ i18n.t('diary.carbs') }} {{ round1(macrosOf(item).carbs) }} g
                  </span>
                  <span class="macro-protein macro-pill">
                    {{ i18n.t('diary.protein') }} {{ round1(macrosOf(item).protein) }} g
                  </span>
                  <span class="macro-fat macro-pill">
                    {{ i18n.t('diary.fat') }} {{ round1(macrosOf(item).fat) }} g
                  </span>
                </div>
              </div>
            }

            <h2 class="section-title">{{ i18n.t('photo.addItem') }}</h2>
            <div class="searchbox">
              <ct-icon class="search-icon" name="search" [size]="18" />
              <input
                class="input query"
                type="text"
                enterkeyhint="search"
                [placeholder]="i18n.t('photo.addPlaceholder')"
                [attr.aria-label]="i18n.t('photo.addPlaceholder')"
                [value]="addQuery()"
                (input)="onAddQueryInput($event)"
              />
            </div>
            @switch (addSearch().status) {
              @case ('idle') {
                <p class="text-muted note-line">
                  {{ i18n.t('addFood.minChars', { n: minQuery }) }}
                </p>
              }
              @case ('loading') {
                <div
                  class="spinner"
                  role="status"
                  [attr.aria-label]="i18n.t('addFood.searching')"
                ></div>
              }
              @case ('empty') {
                <p class="text-muted note-line">{{ i18n.t('addFood.noMatches') }}</p>
              }
              @case ('error') {
                <p class="text-muted note-line">{{ i18n.t('addFood.error') }}</p>
                <button class="btn btn-secondary" type="button" (click)="retry()">
                  {{ i18n.t('addFood.retry') }}
                </button>
              }
              @case ('results') {
                @for (food of addResults(); track food.code) {
                  <button class="alt" type="button" (click)="addFood(food)">
                    <span class="alt-name">{{ resultName(food) }}</span>
                    <span class="text-muted alt-meta">{{ resultMeta(food) }}</span>
                  </button>
                }
              }
            }
          }
        }
      </div>

      @if (phase() === 'capture') {
        <div class="foot">
          <button
            class="btn btn-primary confirm"
            type="button"
            [disabled]="!canAnalyze()"
            (click)="analyze()"
          >
            <ct-icon name="sparkles" />
            {{ i18n.t('photo.analyze') }}
          </button>
        </div>
      }

      @if (phase() === 'review' && items().length > 0) {
        <div class="foot">
          <div class="totals">
            <span class="totals-kcal">{{ round(totals().kcal) }}</span>
            <span class="totals-label">{{ i18n.t('photo.total') }}</span>
            <span class="totals-macros">
              <span class="macro-carbs macro-pill">
                {{ i18n.t('diary.carbs') }} {{ round1(totals().carbs) }} g
              </span>
              <span class="macro-protein macro-pill">
                {{ i18n.t('diary.protein') }} {{ round1(totals().protein) }} g
              </span>
              <span class="macro-fat macro-pill">
                {{ i18n.t('diary.fat') }} {{ round1(totals().fat) }} g
              </span>
            </span>
          </div>
          <button class="btn btn-primary confirm" type="button" (click)="confirm()">
            <ct-icon name="check" />
            {{
              items().length === 1
                ? i18n.t('photo.logOne')
                : i18n.t('photo.logAll', { n: items().length })
            }}
          </button>
        </div>
      }
    </div>
  `,
  styles: `
    .overlay {
      position: absolute;
      inset: 0;
      z-index: 60;
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

    /* Off-screen but focusable: the visible <label for> is the control, which keeps the
       native file picker fully keyboard- and screen-reader-accessible. */
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      overflow: hidden;
      clip-path: inset(50%);
    }
    /* The file input is off-screen, so its focus ring has to show on the label instead. */
    .sr-only:focus-visible + .picker,
    .searchbox:focus-within {
      border-color: var(--color-accent);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 22%, transparent);
    }
    .pickers {
      display: flex;
      gap: var(--space-2);
      margin-bottom: var(--space-4);
    }
    .picker {
      display: flex;
      flex: 1;
      justify-content: center;
      gap: 8px;
      cursor: pointer;
      /* Two buttons share one row, so the longer label wraps rather than overflowing. */
      min-width: 0;
      text-align: center;
    }
    .preview-img {
      display: block;
      width: 100%;
      max-height: 220px;
      object-fit: cover;
      border-radius: 18px;
      border: 1px solid var(--color-divider);
      margin-bottom: var(--space-4);
    }

    .field-label {
      display: block;
      font-size: 12px;
      margin-bottom: 6px;
      color: color-mix(in srgb, var(--color-text) 70%, transparent);
    }
    .hint,
    .note-line {
      font-size: 12px;
      margin: var(--space-2) 0;
    }
    .section-title {
      font-family: var(--font-heading);
      font-weight: 800;
      font-size: 13px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      opacity: 0.7;
      margin: var(--space-6) 0 var(--space-2);
    }

    .meal-seg {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 1px;
      background: var(--color-divider);
      border: 1px solid var(--color-divider);
      border-radius: 12px;
      overflow: hidden;
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

    .item {
      border: 1px solid var(--color-divider);
      border-radius: 16px;
      padding: var(--space-3);
      margin-bottom: var(--space-3);
    }
    .item-head {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      margin-bottom: var(--space-2);
    }
    .item-name {
      flex: 1;
      font-weight: 600;
      font-size: 15px;
    }

    /* Provenance line: which source the per-100g numbers came from. */
    .source {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
      font-size: 12px;
      color: var(--color-text-muted);
      margin: 0 0 var(--space-2);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 999px;
      font-family: var(--font-heading);
      font-weight: 800;
      font-size: 11px;
      border: 1px solid transparent;
    }
    /* Solid tint = a database fact. */
    .badge-db {
      background: var(--color-accent-100);
      color: var(--accent-on-light);
    }
    /* Dashed and untinted = the model's own guess, deliberately not styled as data. */
    .badge-ai {
      border-color: var(--color-text-muted);
      border-style: dashed;
    }

    .stepper {
      display: flex;
      gap: var(--space-2);
      margin-bottom: var(--space-2);
    }
    .step {
      width: 44px;
    }
    .grams {
      text-align: center;
      font-family: var(--font-heading);
      font-weight: 800;
      font-size: 18px;
    }
    .item-macros {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--space-2) var(--space-3);
      font-size: 12px;
    }
    .item-kcal {
      font-size: 12px;
      font-weight: 700;
      color: var(--color-text);
    }

    .alt {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
      width: 100%;
      text-align: left;
      padding: var(--space-2) 0;
      border: 0;
      border-bottom: 1px solid var(--color-divider);
      background: transparent;
      cursor: pointer;
      color: inherit;
      font: inherit;
    }
    .alt-name {
      font-size: 14px;
    }
    .alt-meta {
      font-size: 12px;
    }

    .clarify {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      width: 100%;
      text-align: left;
      padding: var(--space-3);
      margin-bottom: var(--space-3);
      border: 1px solid var(--color-accent);
      border-radius: 14px;
      background: color-mix(in srgb, var(--color-accent) 8%, transparent);
      color: inherit;
      font: inherit;
      font-size: 13px;
      cursor: pointer;
    }
    .clarify-cta {
      margin-left: auto;
      flex: none;
      font-family: var(--font-heading);
      font-weight: 800;
      color: var(--color-accent);
    }

    .searchbox {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      background: var(--color-surface);
      border: 1px solid var(--color-divider);
      padding: 0 10px;
      border-radius: 12px;
      margin-bottom: var(--space-2);
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
    .searchbox .query:focus-visible {
      outline: none;
      border: 0;
      box-shadow: none;
    }

    .spinner {
      width: 44px;
      height: 44px;
      border: 3px solid var(--color-divider);
      border-top-color: var(--color-accent);
      border-radius: 50%;
      margin: var(--space-4) auto;
      animation: ct-pe-spin 0.8s linear infinite;
    }
    @keyframes ct-pe-spin {
      to {
        transform: rotate(360deg);
      }
    }

    /* Placeholder rows during the 2-5s vision call — an empty screen reads as a hang. */
    .skeleton {
      height: 56px;
      border-radius: 14px;
      background: var(--color-surface);
      border: 1px solid var(--color-divider);
      margin-bottom: var(--space-2);
      opacity: 0.6;
      animation: ct-pe-pulse 1.4s ease-in-out infinite;
    }
    @keyframes ct-pe-pulse {
      50% {
        opacity: 0.25;
      }
    }

    .foot {
      flex: none;
      padding: var(--space-3) var(--space-4) var(--space-safe-bottom);
      border-top: 2px solid var(--color-divider);
    }
    /* Centred column: the calorie total is the headline of the review step, so it sits on
       its own centred line with the macro pills under it rather than sharing a row. */
    .totals {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-1);
      margin-bottom: var(--space-3);
      text-align: center;
    }
    .totals-kcal {
      font-family: var(--font-heading);
      font-weight: 800;
      font-size: 34px;
      line-height: 1.1;
    }
    .totals-label {
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      opacity: 0.7;
    }
    /* Labelled pills are wide — wrap and stay centred rather than overflow the footer on a
       narrow screen (Bulgarian "Въглехидрати" is the worst case). */
    .totals-macros {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 4px;
      font-size: 12px;
    }
    .confirm {
      width: 100%;
      justify-content: center;
      padding: var(--space-3);
    }

    @media (prefers-reduced-motion: reduce) {
      .overlay,
      .spinner,
      .skeleton {
        animation: none;
      }
    }
  `,
})
export class PhotoEstimateOverlay {
  protected readonly i18n = inject(I18n);
  private readonly api = inject(PhotoEstimateApi);
  // The same search the Add-Food pane uses, so an ingredient the model missed is looked
  // up in exactly the catalogs the user already knows from there.
  private readonly catalog = inject(FoodCatalogSearch);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly round = round;
  protected readonly round1 = round1;
  protected readonly macrosOf = macrosOf;
  protected readonly mealOrder = MEAL_ORDER;
  protected readonly mealLabelKeys = MEAL_LABEL_KEYS;
  protected readonly gramsStep = GRAMS_STEP;
  protected readonly minQuery = MIN_QUERY_LENGTH;
  protected readonly skeletonRows = [0, 1, 2];

  /** The meal whose "+" opened Add-Food — the default target for the logged items. */
  readonly meal = input.required<MealType>();

  readonly close = output<void>();
  readonly log = output<Omit<LogEntry, 'id'>[]>();

  protected readonly phase = signal<Phase>('capture');
  protected readonly note = signal('');
  protected readonly targetMeal = linkedSignal(() => this.meal());

  private readonly photo = signal<Blob | null>(null);
  protected readonly previewUrl = signal<string | null>(null);
  protected readonly workingKey = signal<TranslationKey>('photo.analyzing');
  protected readonly errorKey = signal<TranslationKey>('photo.error');

  /** The editable working copy — the analysis response is never mutated in place. */
  protected readonly items = signal<ReviewItem[]>([]);
  protected readonly scaleReference = signal<string | null>(null);
  protected readonly hiddenFatsNote = signal<string | null>(null);
  protected readonly clarifyingQuestion = signal<string | null>(null);

  protected readonly addQuery = signal('');
  private readonly retryTick = signal(0);

  private readonly searchKey = computed(() => ({
    query: this.addQuery().trim(),
    lang: this.i18n.lang(),
    tick: this.retryTick(),
  }));

  protected readonly totals = computed(() => sumMacros(this.items()));
  protected readonly canAnalyze = computed(() => this.photo() !== null);

  // The same debounced two-catalog search the Add-Food pane runs — whole foods from our
  // own USDA-seeded table (which carries Bulgarian names) merged with Open Food Facts.
  // `switchMap` drops in-flight requests when the query moves on, so a fast typist only
  // pays for the query they settle on.
  protected readonly addSearch = toSignal(
    toObservable(this.searchKey).pipe(
      debounceTime(DEBOUNCE_MS),
      distinctUntilChanged((a, b) => a.query === b.query && a.lang === b.lang && a.tick === b.tick),
      switchMap(({ query, lang }) => {
        if (query.length < MIN_QUERY_LENGTH) return of<AddSearchState>({ status: 'idle' });
        return this.catalog.search(query, lang).pipe(
          map((results): AddSearchState =>
            results.length > 0 ? { status: 'results', results } : { status: 'empty' },
          ),
          catchError(() => of<AddSearchState>({ status: 'error' })),
          startWith<AddSearchState>({ status: 'loading' }),
        );
      }),
    ),
    { initialValue: { status: 'idle' } as AddSearchState },
  );

  protected readonly addResults = computed<FoodSearchResult[]>(() => {
    const state = this.addSearch();
    return state.status === 'results' ? state.results : [];
  });

  constructor() {
    // Object URLs are a manual allocation — without this the blob is pinned for the life
    // of the document every time a photo is picked.
    this.destroyRef.onDestroy(() => this.revokePreview());
  }

  protected async onFilePicked(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Re-picking the same file must still fire `change`, so clear the input's value.
    input.value = '';
    if (!file) return;

    this.workingKey.set('photo.preparing');
    this.phase.set('working');
    try {
      const prepared = await preparePhoto(file);
      this.photo.set(prepared);
      this.revokePreview();
      this.previewUrl.set(URL.createObjectURL(prepared));
      this.phase.set('capture');
    } catch {
      this.errorKey.set('photo.imageError');
      this.phase.set('error');
    }
  }

  protected onNoteInput(event: Event): void {
    this.note.set((event.target as HTMLInputElement).value);
  }

  protected onAddQueryInput(event: Event): void {
    this.addQuery.set((event.target as HTMLInputElement).value);
  }

  protected analyze(): void {
    const photo = this.photo();
    if (!photo) return;

    this.workingKey.set('photo.analyzing');
    this.phase.set('working');
    this.api.analyze(photo, this.note(), this.i18n.lang()).subscribe({
      next: (estimate) => {
        this.items.set(estimate.items);
        this.scaleReference.set(estimate.scaleReferenceUsed);
        this.hiddenFatsNote.set(estimate.hiddenFatsNote);
        this.clarifyingQuestion.set(estimate.clarifyingQuestion);
        this.phase.set('review');
      },
      error: () => {
        this.errorKey.set('photo.error');
        this.phase.set('error');
      },
    });
  }

  /** Back to the capture step, keeping the photo and note so a retry is one tap. */
  protected backToCapture(): void {
    this.phase.set('capture');
  }

  // The model asked something it couldn't see. Move the question into the note field so
  // the user answers it as context, then re-run — the prompt treats the note as ground
  // truth, which is where the answer does the most good.
  protected answerQuestion(): void {
    const question = this.clarifyingQuestion();
    if (question) {
      const existing = this.note().trim();
      this.note.set(existing ? `${existing}\n${question} ` : `${question} `);
    }
    this.clarifyingQuestion.set(null);
    this.phase.set('capture');
  }

  protected addGrams(id: string, delta: number): void {
    this.updateItem(id, (item) => ({ ...item, grams: Math.max(0, item.grams + delta) }));
  }

  protected onGramsInput(id: string, event: Event): void {
    const value = Number.parseFloat((event.target as HTMLInputElement).value);
    const grams = Number.isFinite(value) && value >= 0 ? value : 0;
    this.updateItem(id, (item) => ({ ...item, grams }));
  }

  protected removeItem(id: string): void {
    this.items.update((items) => items.filter((item) => item.id !== id));
  }

  protected addFood(food: FoodSearchResult): void {
    this.items.update((items) => [
      ...items,
      {
        id: `manual-${crypto.randomUUID()}`,
        // The catalog's name for the active language — a generic food carries a
        // Bulgarian one, and this is also the name the diary entry will keep.
        displayName: displayName(food, this.i18n.lang()),
        grams: 100,
        // Nothing here was estimated: the user picked this row from the database.
        confidence: 'high',
        unresolved: false,
        fdcId: null,
        picked: food,
        kcalPer100g: food.kcalPer100g,
        proteinPer100g: food.proteinPer100g,
        carbsPer100g: food.carbsPer100g,
        fatPer100g: food.fatPer100g,
      },
    ]);
    this.addQuery.set('');
  }

  protected retry(): void {
    this.retryTick.update((tick) => tick + 1);
  }

  /** The label for a row's source badge — where its per-100g numbers actually came from. */
  protected sourceKey(item: ReviewItem): TranslationKey {
    if (item.picked) return item.picked.source === 'generic' ? 'photo.sourceDb' : 'photo.sourceOff';
    return item.unresolved ? 'photo.sourceAi' : 'photo.sourceDb';
  }

  /** A hit's name in the active language — generic foods carry a Bulgarian one. */
  protected resultName(result: FoodSearchResult): string {
    return displayName(result, this.i18n.lang());
  }

  /** One search hit's secondary line: brand (or "generic") and its energy. */
  protected resultMeta(result: FoodSearchResult): string {
    const brand = result.brand ?? this.i18n.t('addFood.generic');
    return `${brand} · ${round(result.kcalPer100g)} ${this.i18n.t('entry.kcalPer100')}`;
  }

  protected confirm(): void {
    const meal = this.targetMeal();
    const entries = this.items()
      // A zero-gram row would be rejected by the API's positive-grams rule, and means the
      // user emptied it rather than deleting it.
      .filter((item) => item.grams > 0)
      .map((item) => ({
        mealType: meal,
        name: item.displayName,
        brand: item.picked?.brand ?? null,
        // A row the user picked from the search was not estimated from the photo, and
        // must not be logged as though it were — it keeps the catalog's own source.
        source: item.picked ? item.picked.source : ('ai' as const),
        // Provenance: the catalog hit's namespaced code, or the resolved USDA id.
        externalId: item.picked
          ? item.picked.code
          : item.fdcId === null
            ? null
            : String(item.fdcId),
        // Neither an estimate nor this search reaches the user's own catalog or recipes.
        customFoodId: null,
        recipeId: null,
        grams: item.grams,
        kcalPer100g: item.kcalPer100g,
        proteinPer100g: item.proteinPer100g,
        carbsPer100g: item.carbsPer100g,
        fatPer100g: item.fatPer100g,
      }));

    if (entries.length > 0) this.log.emit(entries);
  }

  private updateItem(id: string, update: (item: ReviewItem) => ReviewItem): void {
    this.items.update((items) => items.map((item) => (item.id === id ? update(item) : item)));
  }

  private revokePreview(): void {
    const url = this.previewUrl();
    if (url) URL.revokeObjectURL(url);
  }
}

type AddSearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'results'; results: FoodSearchResult[] }
  | { status: 'empty' }
  | { status: 'error' };
