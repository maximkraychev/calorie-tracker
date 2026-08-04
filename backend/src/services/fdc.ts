import { env } from '../config/env.js';
import { AppError } from '../utils/app-error.js';
import { logger } from '../utils/logger.js';
import {
  NUTRIENTS,
  inRange,
  readEnergy,
  readMacro,
  round2,
  type FdcNutrient,
} from './fdc-nutrients.js';
import {
  PROCESSED_MARKERS,
  VARIANT_MARKERS,
  hasBrandToken,
  normalizeTerm,
  tokenize,
} from './fdc-text.js';
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

// FDC's own relevance ordering cannot be trusted for short generic queries: it ranks
// processed derivatives above the whole food they derive from. Measured rank-0 results —
// "tomato" → Tomato powder (302 kcal), "mozzarella cheese" → Cheese substitute,
// "olive oil" → Oil, corn, peanut, and olive, "chicken breast" → breaded tenders.
// So fetch a wide pool, re-rank it locally (see `scoreCandidate`), and keep the top few.
// Pool size costs nothing extra — it is the same single request either way.
const CANDIDATE_POOL = 25;

// One best match plus a handful of alternatives, which the UI offers as "swap this
// food" without a second round trip.
const RESULT_LIMIT = 6;
const REQUEST_TIMEOUT_MS = 10_000;

// The nutrient constants, energy priority, marker word lists and tokenizer live in
// `fdc-nutrients.ts` / `fdc-text.ts` — shared with the offline importer that seeds
// `generic_foods`, so search and seed agree on what a whole food is.

// Any candidate whose energy is this many times away from the vision model's own guess
// is almost certainly a different food. 3x is deliberately loose — raw vs cooked moves
// energy by well under 2x, while tomato-vs-tomato-powder is 17x.
const IMPLAUSIBLE_KCAL_RATIO = 3;

export interface FdcMatch {
  fdcId: number;
  name: string;
  per100g: Per100g;
}

/** A match plus the signals used to rank it, none of which reach the API response. */
interface Candidate {
  match: FdcMatch;
  dataType: string;
  /** FDC's own position, used only to break ties. */
  rank: number;
  /** True when the description carries an ALL-CAPS brand or restaurant token. */
  branded: boolean;
  descriptionTokens: string[];
}

export interface SearchOptions {
  /**
   * The vision model's own per-100g energy guess for this item, used as a plausibility
   * check. Explicitly `| undefined` because the project compiles with
   * exactOptionalPropertyTypes.
   */
  expectedKcal?: number | undefined;
}

interface FdcFood {
  fdcId?: number;
  description?: string;
  dataType?: string;
  foodNutrients?: FdcNutrient[];
}

/**
 * Search FDC for a food term and return usable matches, best first.
 *
 * "Best" is our ranking, not FDC's — see `scoreCandidate`. Resolves to an empty array
 * when nothing matches. Throws `AppError` only when the service itself is unusable
 * (missing key, transport failure, rate limit) so callers can choose between degrading
 * and surfacing the error.
 */
export async function searchFdc(term: string, options: SearchOptions = {}): Promise<FdcMatch[]> {
  if (!env.FDC_API_KEY) {
    throw new AppError('Nutrition lookup is not configured', 503);
  }

  const query = normalizeTerm(term);
  if (!query) return [];

  const url = `${SEARCH_URL}?${new URLSearchParams({
    query,
    dataType: DATA_TYPES,
    pageSize: String(CANDIDATE_POOL),
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
  const candidates = (payload.foods ?? [])
    .map(toCandidate)
    .filter((candidate): candidate is Candidate => candidate !== null);

  const queryTokens = tokenize(query);
  const ranked = candidates
    .map((candidate) => ({
      candidate,
      score: scoreCandidate(candidate, queryTokens, options.expectedKcal),
    }))
    .sort((a, b) => b.score - a.score);

  if (ranked.length > 0) {
    logger.debug(
      {
        query,
        picked: ranked[0]!.candidate.match.name,
        score: round2(ranked[0]!.score),
        fdcRank: ranked[0]!.candidate.rank,
      },
      'FDC match selected',
    );
  }

  return ranked.slice(0, RESULT_LIMIT).map((entry) => entry.candidate.match);
}

/**
 * FDC search results report nutrients per 100 g for Foundation and SR Legacy — the only
 * data types we request. Branded entries mix in per-serving label values, which is the
 * second reason it is excluded above.
 */
function toCandidate(food: FdcFood, rank: number): Candidate | null {
  const { fdcId, description } = food;
  if (typeof fdcId !== 'number' || !description) return null;

  const nutrients = food.foodNutrients ?? [];
  const kcal = readEnergy(nutrients);

  // No resolvable energy value means we would be showing 0 kcal, which reads as real
  // data. Dropping the match lets a worse-but-honest alternative win instead — the same
  // rule the Open Food Facts normaliser already applies on the frontend. Logged because
  // a silent drop here once removed every Foundation food from every result.
  if (kcal === null) {
    logger.debug({ fdcId, description }, 'FDC match has no readable energy — skipped');
    return null;
  }

  const per100g: Per100g = {
    kcal,
    protein: readMacro(nutrients, NUTRIENTS.protein),
    fat: readMacro(nutrients, NUTRIENTS.fat),
    carbs: readMacro(nutrients, NUTRIENTS.carbs),
  };

  // The diary's CHECK constraints cap kcal at 900 and each macro at 100 g per 100 g.
  // A value outside that is corrupt rather than merely extreme (pure oil is 884/100/0/0
  // and passes), so reject the match instead of clamping it into plausibility.
  if (!inRange(per100g)) {
    logger.warn({ fdcId, per100g }, 'FDC match outside plausible range — skipped');
    return null;
  }

  return {
    match: { fdcId, name: description, per100g },
    dataType: food.dataType ?? '',
    rank,
    branded: hasBrandToken(description),
    descriptionTokens: tokenize(description),
  };
}

/**
 * Rank one candidate against the query. Higher is better; the scale is arbitrary and
 * only comparisons within a single result set are meaningful.
 *
 * The shape of an FDC description does most of the work: they read
 * "HeadNoun, qualifier, qualifier", so both *which* qualifiers a description carries and
 * *where* the query's own words land in it are informative. A description full of
 * qualifiers the query never asked for is a more specific food than the one requested.
 */
function scoreCandidate(
  candidate: Candidate,
  queryTokens: string[],
  expectedKcal: number | undefined,
): number {
  const description = candidate.descriptionTokens;
  const query = new Set(queryTokens);

  let score = 0;

  for (const token of queryTokens) {
    const position = description.indexOf(token);

    // A query word the description does not contain at all. The strongest signal by far:
    // asking for "mozzarella cheese" and getting "Cheese, ricotta" should never win.
    if (position === -1) {
      score -= 4;
      continue;
    }

    // Where the word appears matters as much as whether it does. FDC descriptions run
    // head noun first, qualifiers after, so a query word buried at the end describes a
    // minor component rather than the food. This is what separates "Oil, olive, salad or
    // cooking" from "Oil, corn, peanut, and olive" — both contain both query words, but
    // only one of them is actually olive oil.
    score += 2 / (1 + position);
  }

  // Every description word the query did not ask for. Mild, and cumulative — it is what
  // makes the plainest entry win among otherwise equal matches.
  const extras = description.filter((token) => !query.has(token));
  score -= extras.length;

  // Processing and modification words the query did not ask for, on top of the generic
  // extra-word cost.
  score -= extras.filter((token) => PROCESSED_MARKERS.has(token)).length * 10;
  score -= extras.filter((token) => VARIANT_MARKERS.has(token)).length * 4;

  // Brand and restaurant entries ("DENNY'S, mozzarella cheese sticks") are packaged
  // products wearing a generic name.
  if (candidate.branded) score -= 10;

  // Foundation is the current, lab-analysed dataset and skews towards whole foods;
  // SR Legacy is frozen 2019 data. Small enough to only decide near-ties.
  if (candidate.dataType === 'Foundation') score += 2;

  // The vision model already guessed this food's energy. A candidate far away from that
  // guess is probably a different food — demoted, not rejected, because the guess is
  // itself unreliable and must never outrank a real database hit on its own.
  if (expectedKcal !== undefined && expectedKcal > 0) {
    const ratio =
      Math.max(candidate.match.per100g.kcal, expectedKcal) /
      Math.max(Math.min(candidate.match.per100g.kcal, expectedKcal), 1);
    if (ratio > IMPLAUSIBLE_KCAL_RATIO) score -= 8;
  }

  // Ties fall back to FDC's own ordering.
  return score - candidate.rank * 0.01;
}
