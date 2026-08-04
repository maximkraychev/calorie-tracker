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
import { PhotoEstimateApi } from '../data/photo-estimate.api';
import { preparePhoto } from '../data/image-prep';
import { MEAL_LABEL_KEYS, MEAL_ORDER, type LogEntry, type MealType } from '../models/diary.models';
import type { EstimateAlternative, EstimateItem } from '../models/photo-estimate.models';

// Every USDA search costs a request against a 1000/hour budget, so the manual "add an
// ingredient" field waits for a typing pause and ignores near-empty queries — the same
// discipline add-food-overlay applies to Open Food Facts.
const DEBOUNCE_MS = 500;
const MIN_QUERY_LENGTH = 3;

const GRAMS_STEP = 10;

type Phase = 'capture' | 'working' | 'review' | 'error';

/**
 * Photo → editable ingredient list → diary (z 60, opened from the Add-Food overlay).
 *
 * After the analysis returns, everything is local arithmetic: the response carries
 * per-100g values for every item, so changing grams, swapping a match, or deleting a row
 * never touches the network. Only Confirm writes anything.
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

                @if (item.unresolved) {
                  <p class="unresolved">
                    <ct-icon name="alert" [size]="14" />
                    <span class="badge">{{ i18n.t('photo.unresolved') }}</span>
                    {{ i18n.t('photo.unresolvedHint') }}
                  </p>
                }

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
                  <span>{{ i18n.t('diary.protein') }} {{ round1(macrosOf(item).protein) }} g</span>
                  <span>{{ i18n.t('diary.carbs') }} {{ round1(macrosOf(item).carbs) }} g</span>
                  <span>{{ i18n.t('diary.fat') }} {{ round1(macrosOf(item).fat) }} g</span>
                </div>

                @if (item.alternatives.length > 0) {
                  @if (swapForId() === item.id) {
                    <div class="alts" role="group" [attr.aria-label]="i18n.t('photo.swapTitle')">
                      @for (alt of item.alternatives; track alt.fdcId) {
                        <button class="alt" type="button" (click)="swapTo(item.id, alt)">
                          <span class="alt-name">{{ alt.name }}</span>
                          <span class="text-muted alt-meta">
                            {{ round(alt.kcalPer100g) }} {{ i18n.t('entry.kcalPer100') }}
                          </span>
                        </button>
                      }
                    </div>
                  } @else {
                    <button class="btn btn-ghost swap" type="button" (click)="openSwap(item.id)">
                      {{ i18n.t('photo.swap') }}
                    </button>
                  }
                }
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
              }
              @case ('results') {
                @for (food of addResults(); track food.fdcId) {
                  <button class="alt" type="button" (click)="addFood(food)">
                    <span class="alt-name">{{ food.name }}</span>
                    <span class="text-muted alt-meta">
                      {{ round(food.kcalPer100g) }} {{ i18n.t('entry.kcalPer100') }}
                    </span>
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
            <span class="text-muted totals-macros">
              {{ round1(totals().protein) }} / {{ round1(totals().carbs) }} /
              {{ round1(totals().fat) }} g
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

    /* Unverified numbers must not read as database facts — hence the dashed badge. */
    .unresolved {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
      font-size: 12px;
      color: var(--color-text-muted);
      margin: 0 0 var(--space-2);
    }
    .badge {
      padding: 2px 8px;
      border-radius: 999px;
      font-family: var(--font-heading);
      font-weight: 800;
      font-size: 11px;
      border: 1px dashed var(--color-text-muted);
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
      flex-wrap: wrap;
      gap: var(--space-2) var(--space-3);
      font-size: 12px;
    }
    .item-kcal {
      font-weight: 700;
      color: var(--color-text);
    }
    .swap,
    .alts {
      margin-top: var(--space-2);
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
      padding: var(--space-3) var(--space-4);
      border-top: 2px solid var(--color-divider);
    }
    .totals {
      display: flex;
      align-items: baseline;
      gap: var(--space-2);
      margin-bottom: var(--space-2);
    }
    .totals-kcal {
      font-family: var(--font-heading);
      font-weight: 800;
      font-size: 26px;
    }
    .totals-label {
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      opacity: 0.7;
    }
    .totals-macros {
      margin-left: auto;
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
  private readonly destroyRef = inject(DestroyRef);

  protected readonly round = round;
  protected readonly round1 = round1;
  protected readonly macrosOf = macrosOf;
  protected readonly mealOrder = MEAL_ORDER;
  protected readonly mealLabelKeys = MEAL_LABEL_KEYS;
  protected readonly gramsStep = GRAMS_STEP;
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
  protected readonly items = signal<EstimateItem[]>([]);
  protected readonly scaleReference = signal<string | null>(null);
  protected readonly hiddenFatsNote = signal<string | null>(null);
  protected readonly clarifyingQuestion = signal<string | null>(null);
  protected readonly swapForId = signal<string | null>(null);

  protected readonly addQuery = signal('');

  protected readonly totals = computed(() => sumMacros(this.items()));
  protected readonly canAnalyze = computed(() => this.photo() !== null);

  // Debounced USDA search for the manual-add field. `switchMap` drops in-flight requests
  // when the query moves on, so a fast typist only pays for the query they settle on.
  protected readonly addSearch = toSignal(
    toObservable(this.addQuery).pipe(
      debounceTime(DEBOUNCE_MS),
      distinctUntilChanged(),
      switchMap((raw) => {
        const query = raw.trim();
        if (query.length < MIN_QUERY_LENGTH) return of({ status: 'idle' } as AddSearchState);
        return this.api.searchFoods(query).pipe(
          map((results): AddSearchState =>
            results.length > 0 ? { status: 'results', results } : { status: 'empty' },
          ),
          catchError(() => of({ status: 'error' } as AddSearchState)),
          startWith({ status: 'loading' } as AddSearchState),
        );
      }),
    ),
    { initialValue: { status: 'idle' } as AddSearchState },
  );

  protected readonly addResults = computed<EstimateAlternative[]>(() => {
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
        this.swapForId.set(null);
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

  protected openSwap(id: string): void {
    this.swapForId.set(id);
  }

  // Swapping keeps the user's grams and the alternatives list, so the choice stays
  // reversible — only the identity and the per-100g values change.
  protected swapTo(id: string, alt: EstimateAlternative): void {
    this.updateItem(id, (item) => ({
      ...item,
      displayName: alt.name,
      fdcId: alt.fdcId,
      unresolved: false,
      kcalPer100g: alt.kcalPer100g,
      proteinPer100g: alt.proteinPer100g,
      carbsPer100g: alt.carbsPer100g,
      fatPer100g: alt.fatPer100g,
    }));
    this.swapForId.set(null);
  }

  protected addFood(food: EstimateAlternative): void {
    this.items.update((items) => [
      ...items,
      {
        id: `manual-${crypto.randomUUID()}`,
        displayName: food.name,
        grams: 100,
        confidence: 'high',
        unresolved: false,
        fdcId: food.fdcId,
        kcalPer100g: food.kcalPer100g,
        proteinPer100g: food.proteinPer100g,
        carbsPer100g: food.carbsPer100g,
        fatPer100g: food.fatPer100g,
        alternatives: [],
      },
    ]);
    this.addQuery.set('');
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
        brand: null,
        source: 'ai' as const,
        // Provenance only, and only when USDA actually resolved it.
        externalId: item.fdcId === null ? null : String(item.fdcId),
        // An estimate never comes from the user's own catalog.
        customFoodId: null,
        grams: item.grams,
        kcalPer100g: item.kcalPer100g,
        proteinPer100g: item.proteinPer100g,
        carbsPer100g: item.carbsPer100g,
        fatPer100g: item.fatPer100g,
      }));

    if (entries.length > 0) this.log.emit(entries);
  }

  private updateItem(id: string, update: (item: EstimateItem) => EstimateItem): void {
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
  | { status: 'results'; results: EstimateAlternative[] }
  | { status: 'empty' }
  | { status: 'error' };
