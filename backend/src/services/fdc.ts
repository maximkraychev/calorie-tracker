import { env } from '../config/env.js';
import { AppError } from '../utils/app-error.js';
import { logger } from '../utils/logger.js';
import type { Per100g } from './photo-estimate/types.js';

// USDA FoodData Central — the source of truth for macros. Public domain, no attribution
// obligation, 1,000 requests/hour per key. A typical meal costs ~5 lookups, so the
// budget is roughly 200 meals/hour: not a constraint at the current user count, but the
// reason lookups run in parallel and 429s degrade instead of failing.
const SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';

// Branded is excluded deliberately: it is mostly US retail packaging and outranks
// generic whole foods on text match, so "chicken breast" would return a frozen breaded
// ready-meal instead of the raw ingredient.
//
// "Survey (FNDDS)" is excluded for a second, empirical reason: the parentheses in that
// value make FDC's edge proxy return an intermittent HTML 400 — measured at 3-5 successes
// per 10 identical requests across every encoding tried (%28/%29, literal, plus-encoded,
// repeated params), and unrelated to connection reuse. Dropping it is 10/10. The value
// cannot be expressed without parens: `dataType=Survey` is accepted but silently matches
// nothing. No real loss here — FNDDS catalogues mixed "as consumed" survey dishes, while
// the prompt deliberately decomposes meals into the generic whole-food ingredients that
// Foundation and SR Legacy cover.
const DATA_TYPES = 'Foundation,SR Legacy';

// One best match plus a handful of alternatives, which the UI offers as "swap this
// food" without a second round trip.
const PAGE_SIZE = 6;
const REQUEST_TIMEOUT_MS = 10_000;

// Nutrients are identified by both a legacy number and a modern id; entries in the wild
// carry one or the other, so match on either.
const NUTRIENTS = {
  kcal: { numbers: ['208'], ids: [1008] },
  protein: { numbers: ['203'], ids: [1003] },
  fat: { numbers: ['204'], ids: [1004] },
  carbs: { numbers: ['205'], ids: [1005] },
  // Some Foundation entries report energy only in kilojoules.
  kj: { numbers: ['268'], ids: [1062] },
} as const;

const KJ_PER_KCAL = 4.184;

export interface FdcMatch {
  fdcId: number;
  name: string;
  per100g: Per100g;
}

interface FdcNutrient {
  nutrientId?: number;
  nutrientNumber?: string;
  unitName?: string;
  value?: number;
  // The /food/{id} detail endpoint nests these; /foods/search flattens them. Handled
  // for safety in case a future call site uses the detail shape.
  nutrient?: { id?: number; number?: string; unitName?: string };
  amount?: number;
}

interface FdcFood {
  fdcId?: number;
  description?: string;
  foodNutrients?: FdcNutrient[];
}

/**
 * Search FDC for a food term and return usable matches, best first.
 *
 * Resolves to an empty array when nothing matches. Throws `AppError` only when the
 * service itself is unusable (missing key, transport failure, rate limit) so callers
 * can choose between degrading and surfacing the error.
 */
export async function searchFdc(term: string): Promise<FdcMatch[]> {
  if (!env.FDC_API_KEY) {
    throw new AppError('Nutrition lookup is not configured', 503);
  }

  const query = normalizeTerm(term);
  if (!query) return [];

  const url = `${SEARCH_URL}?${new URLSearchParams({
    query,
    dataType: DATA_TYPES,
    pageSize: String(PAGE_SIZE),
  })}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'X-Api-Key': env.FDC_API_KEY },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    logger.warn({ err: (err as Error).message, query }, 'FDC request failed');
    throw new AppError('Nutrition lookup is temporarily unavailable', 503);
  }

  if (response.status === 429) {
    // Loud on purpose: at 1,000/hour this should not happen at current usage, so it
    // means either a traffic change or a runaway loop.
    logger.error({ query }, 'FDC rate limit exceeded (1000/hour)');
    throw new AppError('Nutrition lookup is temporarily unavailable', 503);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    logger.error({ status: response.status, detail: detail.slice(0, 300) }, 'FDC error');
    throw new AppError('Nutrition lookup is temporarily unavailable', 503);
  }

  const payload = (await response.json()) as { foods?: FdcFood[] };
  return (payload.foods ?? []).map(toMatch).filter((match): match is FdcMatch => match !== null);
}

/**
 * FDC search results report nutrients per 100 g for Foundation, SR Legacy and Survey
 * (FNDDS) — the only data types we request. Branded entries mix in per-serving label
 * values, which is the second reason it is excluded above.
 */
function toMatch(food: FdcFood): FdcMatch | null {
  const { fdcId, description } = food;
  if (typeof fdcId !== 'number' || !description) return null;

  const nutrients = food.foodNutrients ?? [];
  const kcal = readNutrient(nutrients, NUTRIENTS.kcal) ?? kcalFromKj(nutrients);

  // No resolvable energy value means we would be showing 0 kcal, which reads as real
  // data. Dropping the match lets a worse-but-honest alternative win instead — the same
  // rule the Open Food Facts normaliser already applies on the frontend.
  if (kcal === null) return null;

  const per100g: Per100g = {
    kcal,
    protein: readNutrient(nutrients, NUTRIENTS.protein) ?? 0,
    fat: readNutrient(nutrients, NUTRIENTS.fat) ?? 0,
    carbs: readNutrient(nutrients, NUTRIENTS.carbs) ?? 0,
  };

  // The diary's CHECK constraints cap kcal at 900 and each macro at 100 g per 100 g.
  // A value outside that is corrupt rather than merely extreme (pure oil is 884/100/0/0
  // and passes), so reject the match instead of clamping it into plausibility.
  if (!inRange(per100g)) {
    logger.warn({ fdcId, per100g }, 'FDC match outside plausible range — skipped');
    return null;
  }

  return { fdcId, name: description, per100g };
}

function readNutrient(
  nutrients: FdcNutrient[],
  spec: { numbers: readonly string[]; ids: readonly number[] },
): number | null {
  for (const entry of nutrients) {
    const number = entry.nutrientNumber ?? entry.nutrient?.number;
    const id = entry.nutrientId ?? entry.nutrient?.id;
    const matches =
      (number !== undefined && spec.numbers.includes(number)) ||
      (id !== undefined && spec.ids.includes(id));
    if (!matches) continue;

    const value = entry.value ?? entry.amount;
    if (typeof value === 'number' && Number.isFinite(value)) return round2(value);
  }
  return null;
}

function kcalFromKj(nutrients: FdcNutrient[]): number | null {
  const kj = readNutrient(nutrients, NUTRIENTS.kj);
  return kj === null ? null : round2(kj / KJ_PER_KCAL);
}

function inRange({ kcal, protein, carbs, fat }: Per100g): boolean {
  return (
    kcal >= 0 && kcal <= 900 && [protein, carbs, fat].every((macro) => macro >= 0 && macro <= 100)
  );
}

/**
 * FDC matches on plain text, so trim the query down to the words that carry meaning.
 * Deliberately simple — an over-clever normaliser does more damage than the punctuation
 * it removes.
 */
function normalizeTerm(term: string): string {
  return term
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
