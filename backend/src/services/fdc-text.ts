// Text handling for FDC food descriptions: the word lists and the tokenizer that both
// the live search ranking (`fdc.ts`) and the offline importer
// (`scripts/import-generic-foods.ts`) rank and filter with.
//
// Shared rather than copied because the two must agree: the importer uses these markers
// to decide what a "whole food" is, and the search ranker uses them to decide what wins.
// If they drift, foods get seeded that search then refuses to surface.

/**
 * Words that mark a processed derivative rather than the food itself. Penalised only
 * when the query did NOT ask for them, so "sun dried tomato" or "canned tuna" still
 * resolve normally — this demotes the powder when you asked for a tomato, nothing more.
 */
export const PROCESSED_MARKERS = new Set([
  'powder',
  'powdered',
  'substitute',
  'imitation',
  'canned',
  'dried',
  'dehydrated',
  'concentrate',
  'concentrated',
  'condensed',
  'breaded',
  'battered',
  'sauce',
  'juice',
  'paste',
  'puree',
  'pickle',
  'pickled',
  'stick',
  'nugget',
  'patty',
  'roll',
  'lunchmeat',
  'luncheon',
  'sweetened',
  'candied',
  'infant',
  'formula',
  'baby',
  'snack',
  'dessert',
  'mix',
  'supplement',
]);

/**
 * Nutritionally modified versions of a food. Same rule as above — only penalised when
 * unasked-for — but a milder one, because these are still the food itself. Without this,
 * "mozzarella cheese" resolves to "Cheese, mozzarella, nonfat" (141 kcal) purely because
 * it carries one fewer qualifier than "Cheese, mozzarella, whole milk" (299 kcal).
 */
export const VARIANT_MARKERS = new Set([
  'nonfat',
  'lowfat',
  'skim',
  'skimmed',
  'low',
  'reduced',
  'light',
  'lite',
  'free',
  'diet',
  'unsweetened',
  'enriched',
  'fortified',
]);

/**
 * Connectives carry no meaning but distort both the extra-word count and the position
 * bonus. "with" and "without" are deliberately kept: they invert meaning.
 */
export const STOPWORDS = new Set(['and', 'or', 'the', 'of', 'in']);

/**
 * FDC matches on plain text, so trim the query down to the words that carry meaning.
 * Deliberately simple — an over-clever normaliser does more damage than the punctuation
 * it removes.
 */
export function normalizeTerm(term: string): string {
  return term
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Split text into comparable words. Plurals are folded because FDC is inconsistent about
 * them ("Tomato, roma" and "Tomatoes, red, ripe, raw" are both in the same result set),
 * and one-letter fragments are dropped so possessives like "DENNY'S" do not leave a
 * stray "s" behind.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1)
    .map(singularize)
    .filter((token) => !STOPWORDS.has(token));
}

/**
 * Split a **user query** into comparable words, in any script.
 *
 * Separate from `tokenize` because that one is built for FDC descriptions, which are
 * always English: it splits on `[^a-z0-9]+`, so every Cyrillic character counts as a
 * separator and "банан" tokenizes to nothing at all. A caller that then asks "does the
 * row contain every query token?" gets a vacuous `true` and matches the entire table.
 *
 * Splits on any non-letter/non-digit instead, and applies the English plural rules only
 * to Latin tokens — Bulgarian plurals are handled by listing both forms in
 * `seed/bg-food-terms.json`, since "банани" is not "банан" + s.
 */
export function tokenizeQuery(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1)
    .map((token) => (/^[a-z0-9]+$/.test(token) ? singularize(token) : token))
    .filter((token) => !STOPWORDS.has(token));
}

/**
 * Divides `generic_foods.search_text` into a leading head-noun zone and the rest:
 *
 *   apple, ябълка, ябълки | apples, raw, with skin ...
 *
 * A query word found before the separator names what the food IS; after it, the word
 * merely appears somewhere in the description. Kept in the stored column so the
 * distinction survives into Bulgarian, where comparing against the English name would
 * make every row tie. See `buildSearchText` in scripts/import-generic-foods.ts.
 */
export const SEARCH_TEXT_HEAD_SEPARATOR = '|';

/**
 * The head terms, comma-separated inside the zone:
 *
 *   apple, ябълка, ябълки | apples, raw, with skin …
 *
 * They are kept as separate terms rather than one blob because a multi-word head like
 * "дива ябълка" (crabapple) contains "ябълка", and a flat string cannot tell "this food
 * IS an apple" from "this food's name ends in apple". Same distinction English gets for
 * free from the name starting with the head noun.
 */
export function headTermsOf(searchText: string): string[] {
  const index = searchText.indexOf(SEARCH_TEXT_HEAD_SEPARATOR);
  if (index === -1) return [];
  return searchText
    .slice(0, index)
    .split(',')
    .map((term) => term.trim())
    .filter(Boolean);
}

/**
 * Does `token` name what the food IS — i.e. does it START one of the head terms?
 *
 * Anchored at the term start, so "ябълка" matches the head term "ябълка" but not "дива
 * ябълка", exactly as "apple" matches "Apples, raw" but not "Rose-apples, raw".
 */
export function matchesHeadTerm(searchText: string, token: string): boolean {
  return headTermsOf(searchText).some(
    (term) => wordMatch(term, token) !== null && term.startsWith(token),
  );
}

export type WordMatch = 'exact' | 'prefix' | null;

/**
 * How well `token` matches a word in `haystack`: as a complete word, only as a word
 * prefix, or not at all.
 *
 * Plain substring matching is unusable for food search — "egg" hits *Eggplant*, "apple"
 * hits *Pineapple*, "pea" hits *Peach* and *Peanut* — so matching is anchored to a word
 * start. But it must stay a PREFIX match, because "tomato" has to reach "tomatoes" and
 * "банан" has to reach "банани"; requiring a trailing boundary would break every plural.
 *
 * Hence the three-way result rather than a boolean: prefix matches are kept as hits, and
 * the caller demotes them. That is what separates "Egg, whole, raw" (exact) from
 * "Eggplant, raw" (prefix) for the query "egg" — both legitimately match the pattern,
 * only one is what was asked for.
 */
export function wordMatch(haystack: string, token: string): WordMatch {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const boundary = '[^\\p{L}\\p{N}]';
  if (new RegExp(`(^|${boundary})${escaped}(${boundary}|$)`, 'u').test(haystack)) return 'exact';
  if (new RegExp(`(^|${boundary})${escaped}`, 'u').test(haystack)) return 'prefix';
  return null;
}

export function singularize(token: string): string {
  // "glass" and "grass" are not plurals; neither is anything this short.
  if (token.length <= 3 || !token.endsWith('s') || token.endsWith('ss')) return token;
  if (token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  // The "-es" plurals: tomatoes, glasses, dishes, batches, boxes.
  if (/(oes|sses|shes|ches|xes|zes)$/.test(token)) return token.slice(0, -2);
  // Everything else drops the "s" only, so "juices" folds to "juice" and not "juic".
  return token.slice(0, -1);
}

/** FDC writes brand and restaurant names in caps: "DENNY'S", "KENTUCKY FRIED CHICKEN". */
export function hasBrandToken(description: string): boolean {
  return /\b[A-Z]{3,}\b/.test(description);
}
