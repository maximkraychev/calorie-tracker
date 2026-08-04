/**
 * Turn the USDA FoodData Central bulk downloads into the committed `generic_foods`
 * seed file.
 *
 *   npm run seed:generate            # specified filters only
 *   npm run seed:generate -- --strict  # additionally drop processed/branded rows
 *   npm run seed:generate -- --report  # report only, write nothing
 *
 * Input  (gitignored, ~217 MB): data/foundation.json, data/sr_legacy.json
 * Output (committed, a few MB):  seed/generic-foods.ndjson
 *
 * Why a committed intermediate rather than importing straight into Postgres: the raw
 * dumps are too big to commit and the filtering decisions below are the interesting
 * part. A reviewable NDJSON file means the seed step (`scripts/seed-generic-foods.ts`)
 * is a dumb batched upsert, and re-seeding a fresh database needs no 217 MB download.
 *
 * The dumps are read with a streaming brace scanner, never JSON.parse'd whole —
 * sr_legacy.json is 205 MB and would need a --max-old-space-size bump to parse in one
 * piece. Peak memory here is one food record plus the kept rows.
 */

import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { inRange, readEnergy, readMacro, NUTRIENTS } from '../src/services/fdc-nutrients.js';
import type { FdcNutrient } from '../src/services/fdc-nutrients.js';
import {
  PROCESSED_MARKERS,
  SEARCH_TEXT_HEAD_SEPARATOR,
  VARIANT_MARKERS,
  hasBrandToken,
  tokenize,
  wordMatch,
} from '../src/services/fdc-text.js';
import { rankFoods } from '../src/services/food-search.js';
import type { GenericFoodPortion } from '../src/db/schema.js';
import type { Per100g } from '../src/services/photo-estimate/types.js';

const BACKEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Both dumps are read into one table. Which of the two a row came from is deliberately
// not recorded or scored — see `computeRank` for why provenance turned out to be a worse
// signal than the name itself.
const SOURCES = ['data/foundation.json', 'data/sr_legacy.json'] as const;
const OUTPUT_FILE = 'seed/generic-foods.ndjson';
/** English→Bulgarian food terms, merged into `search_text` so search is language-agnostic. */
const BG_TERMS_FILE = 'seed/bg-food-terms.json';
/** Hand-written per-food Bulgarian: display name + the words to find it by. Authoritative. */
const BG_TRANSLATIONS_FILE = 'seed/bg-translations.json';

/**
 * Categories that contain foods you'd log as an ingredient. Everything outside this set
 * is dropped — the excluded categories (Baked Products, Fast Foods, Restaurant Foods,
 * Meals/Entrees, Snacks, Sweets, Soups/Sauces/Gravies, Sausages and Luncheon Meats,
 * Breakfast Cereals, Baby Foods, Beverages, American Indian/Alaska Native Foods) are
 * either packaged products that Open Food Facts covers far better, or composite dishes
 * that belong in a recipe rather than a food catalog.
 *
 * Exact strings, matched verbatim against `foodCategory.description`. A typo here fails
 * loudly via the unmatched-category report at the end rather than silently dropping a
 * whole category.
 */
const CATEGORY_ALLOWLIST = new Set([
  'Fruits and Fruit Juices',
  'Vegetables and Vegetable Products',
  'Dairy and Egg Products',
  'Poultry Products',
  'Beef Products',
  'Pork Products',
  'Lamb, Veal, and Game Products',
  'Finfish and Shellfish Products',
  'Legumes and Legume Products',
  'Nut and Seed Products',
  'Cereal Grains and Pasta',
  'Fats and Oils',
  'Spices and Herbs',
]);

/**
 * Administrative boilerplate USDA appends to descriptions. Pure noise in a food name,
 * and it also drags an ALL-CAPS "USDA" into the text, which would make every one of
 * these rows look branded to `hasBrandToken`. Stripped before any other name handling.
 */
const NAME_NOISE = [/\s*\(Includes foods for USDA's Food Distribution Program\)/gi];

/**
 * Words naming a COMPONENT of a food rather than the food. Demoted so a bare query lands
 * on the whole item. Deliberately excludes colour-ish words that are only sometimes parts
 * — "white" is egg white but also white rice and white beans.
 */
const PART_MARKERS = new Set([
  'yolk',
  'peel',
  'rind',
  'bran',
  'germ',
  'pulp',
  'core',
  'stem',
  'leaves',
  'skin',
  'giblets',
]);

/** A serving size above this is a bulk measure ("1 lb", 453.6 g), not a serving. */
const MAX_SERVING_G = 500;

/** Portions outside this are unusable as a household measure. */
const MIN_PORTION_G = 0.1;
const MAX_PORTION_G = 2000;

// --- Shapes present in the bulk downloads -----------------------------------------
// The bulk files use the NESTED nutrient shape (`nutrient.number`); the live API
// flattens it. `readNutrient` in fdc-nutrients.ts handles both, which is exactly why
// this script reuses it instead of reading `amount` directly.

interface BulkPortion {
  amount?: number;
  value?: number;
  modifier?: string;
  gramWeight?: number;
  measureUnit?: { name?: string };
}

interface BulkFood {
  fdcId?: number;
  description?: string;
  dataType?: string;
  foodCategory?: { description?: string };
  foodNutrients?: FdcNutrient[];
  foodPortions?: BulkPortion[];
}

/** One row of the seed file — the `generic_foods` insert shape. */
interface SeedRow {
  source: 'usda';
  externalId: string;
  name: string;
  nameBg: string | null;
  searchText: string;
  category: string;
  kcalPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  servingSizeG: number | null;
  portions: GenericFoodPortion[];
  rank: number;
}

interface Stats {
  total: number;
  categoryRejected: number;
  noEnergy: number;
  outOfRange: number;
  malformed: number;
  duplicate: number;
  processed: number;
  branded: number;
  kept: number;
}

// ---------------------------------------------------------------------------
// Streaming reader
// ---------------------------------------------------------------------------

/**
 * Yield each food object of a bulk dump as a raw JSON string.
 *
 * The dumps are `{"FoundationFoods": [ {...}, {...}, null, null ]}` — one object per
 * line today, but that is an artefact of USDA's exporter, not a guarantee, so this
 * tracks brace depth (skipping braces inside strings) instead of splitting on newlines.
 * Scanning starts after the first `[`, which is the array opening: no key name in these
 * files contains a bracket. The trailing `null` padding Foundation ships is skipped for
 * free, since only `{` opens an object.
 */
async function* streamFoodObjects(filePath: string): AsyncGenerator<string> {
  const stream = createReadStream(filePath, { encoding: 'utf8', highWaterMark: 1 << 20 });

  let started = false; // seen the array's opening '['
  let depth = 0;
  let inString = false;
  let escaped = false;
  let pending = ''; // object prefix carried over from previous chunks

  for await (const chunk of stream as AsyncIterable<string>) {
    // An object left open by the previous chunk continues at this chunk's first char.
    let sliceStart = depth > 0 ? 0 : -1;

    for (let i = 0; i < chunk.length; i++) {
      const char = chunk[i]!;

      if (!started) {
        if (char === '[') started = true;
        continue;
      }

      // Between objects: commas, whitespace and `null` padding, none of them interesting.
      if (depth === 0) {
        if (char === '{') {
          depth = 1;
          sliceStart = i;
        }
        continue;
      }

      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }

      if (char === '"') inString = true;
      else if (char === '{') depth++;
      else if (char === '}') {
        depth--;
        if (depth === 0) {
          yield pending + chunk.slice(sliceStart, i + 1);
          pending = '';
          sliceStart = -1;
        }
      }
    }

    if (depth > 0 && sliceStart >= 0) pending += chunk.slice(sliceStart);
  }
}

// ---------------------------------------------------------------------------
// Field extraction
// ---------------------------------------------------------------------------

/**
 * Tidy a USDA description into a display name.
 *
 * Deliberately conservative: the "HeadNoun, qualifier, qualifier" order is kept rather
 * than rewritten into prose. It reads fine ("Bananas, raw"), sorts sensibly, and any
 * clever re-ordering mangles the long ones ("Beef, chuck, arm pot roast, separable lean
 * only, trimmed to 1/8" fat, all grades, raw").
 */
function cleanName(description: string): string {
  let name = description;
  for (const pattern of NAME_NOISE) name = name.replace(pattern, '');

  return name
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/^[\s,]+|[\s,.]+$/g, '')
    .trim();
}

/**
 * Household measures for the grams input.
 *
 * The label lives in different fields depending on the row: `measureUnit.name` is
 * literally the string "undetermined" for ~97% of portions, and the real text ("cup,
 * sliced", "fruit (2\" dia)") sits in `modifier`. "RACC" is the FDA's Reference Amount
 * Customarily Consumed — a regulatory serving, shown as "serving".
 */
function readPortions(raw: BulkPortion[] | undefined): GenericFoodPortion[] {
  const portions: GenericFoodPortion[] = [];
  const seen = new Set<string>();

  for (const entry of raw ?? []) {
    const grams = entry.gramWeight;
    if (typeof grams !== 'number' || !Number.isFinite(grams)) continue;
    if (grams < MIN_PORTION_G || grams > MAX_PORTION_G) continue;

    const unit = entry.measureUnit?.name;
    const modifier = entry.modifier?.trim();

    let measure: string;
    if (unit === 'RACC') measure = 'serving';
    else if (!unit || unit === 'undetermined') measure = modifier ?? '';
    else measure = modifier ? `${unit}, ${modifier}` : unit;

    measure = measure.replace(/\s+/g, ' ').trim();
    if (!measure) continue;

    const amount = entry.amount ?? entry.value ?? 1;
    const label = `${round2(amount)} ${measure}`;

    // The same measure can appear twice with different lab weights; keep the first.
    if (seen.has(label)) continue;
    seen.add(label);
    portions.push({ label, grams: round2(grams) });
  }

  return portions;
}

/**
 * The single portion the UI pre-fills. A "1 lb" or "1 cup, sliced" entry is a valid
 * portion but a poor default, so prefer the two measures that actually mean "a serving"
 * before falling back to the first plausible one.
 */
function pickServingSize(portions: GenericFoodPortion[]): number | null {
  const preferred =
    portions.find((p) => / serving$/.test(p.label)) ??
    portions.find((p) => /NLEA serving/i.test(p.label)) ??
    portions.find((p) => p.grams <= MAX_SERVING_G);

  return preferred ? preferred.grams : null;
}

/**
 * The lowercased haystack search matches against.
 *
 * Holds the full name, any singular forms it does not already contain, and the Bulgarian
 * term for every word of the name the dictionary knows. That last part is what makes
 * "банан" and "banana" find the same row from one GIN index — and it is the reason the
 * index is on `search_text` rather than on `name`.
 *
 * Synonyms are injected per WORD, not per row, so one dictionary entry ("banana" →
 * "банан") covers every banana in the dataset, including ones added by a future USDA
 * release. `name_bg` is null for every row today and is concatenated anyway, so a
 * curated Bulgarian display name later is an UPDATE of two columns, not a migration.
 *
 * The category is deliberately NOT included: "Fruits and Fruit Juices" would make every
 * apple match a search for "juice".
 */
function buildSearchText(
  name: string,
  nameBg: string | null,
  bgTerms: BgTerms,
  translation: BgTranslation | undefined,
): string {
  const base = name.toLowerCase();
  const parts = [base];
  if (nameBg) parts.push(nameBg.toLowerCase());

  const tokens = tokenize(`${name} ${nameBg ?? ''}`);
  const tokenSet = new Set(tokens);
  const extras = new Set<string>();

  for (const token of tokens) {
    // The singular form, whenever the name does not already carry it as a WHOLE word.
    // A substring test is not enough: "bananas, raw" contains the letters "banana" but
    // has no standalone "banana" for search to match exactly, so the row would lose to
    // any food whose name happens to spell it out ("Pepper, banana, raw").
    if (!parts.some((part) => wordMatch(part, token) === 'exact')) extras.add(token);
    for (const bg of bgTerms.single.get(token) ?? []) extras.add(bg);
  }

  // Multi-word entries only fire when the name carries every one of their words, which
  // is what keeps "зехтин" (olive OIL) off the olives themselves.
  for (const phrase of bgTerms.phrases) {
    if (phrase.tokens.every((token) => tokenSet.has(token))) {
      for (const bg of phrase.bulgarian) extras.add(bg);
    }
  }

  // The head-noun zone: the first word of the name plus its translations, ahead of a
  // separator. USDA names read "HeadNoun, qualifier, qualifier", so this is the word that
  // says what the food IS — "Apples, raw, with skin" is an apple, "Rose-apples, raw" is a
  // different fruit whose name merely contains it.
  //
  // It lives in the column rather than being derived at query time because the test has
  // to work in Bulgarian too: comparing a query against the English name means "ябълка"
  // matches no head noun at all and every apple-ish row ties. Putting the translations
  // here keeps search a single indexed string comparison in either language.
  // A hand-written `head` is authoritative and replaces the dictionary lookup entirely —
  // that is the point of translating per food: "Beans, snap, green" is зелен фасул, which
  // no per-word dictionary derives. The English head token stays so English still matches.
  const head = tokens[0];
  const headBg = translation?.head ?? (head ? (bgTerms.single.get(head) ?? []) : []);
  const headZone = head ? [head, ...headBg] : [...headBg];

  for (const term of translation?.terms ?? []) extras.add(term.toLowerCase());

  // Head terms are comma-separated: "дива ябълка" must stay one term, or a query for
  // "ябълка" would match inside it and crabapple would rank as an apple.
  return [headZone.join(', '), SEARCH_TEXT_HEAD_SEPARATOR, ...parts, ...extras]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Bulgarian display names
// ---------------------------------------------------------------------------

/**
 * One hand-written Bulgarian translation, keyed by fdcId in `seed/bg-translations.json`.
 *
 * Authoritative: where a food has an entry, it overrides both the composed name and the
 * per-word search dictionary. Written by hand rather than generated so the wording is a
 * decision, and so re-importing a new USDA release never rewrites text anyone reviewed —
 * only genuinely new foods are missing from the file.
 */
interface BgTranslation {
  /** Display name → `name_bg`. */
  bg: string;
  /** Words naming what the food IS → the head zone of `search_text`. */
  head: string[];
  /** Extra words worth finding it by, e.g. боб also being called фасул. */
  terms?: string[];
}

async function loadBgTranslations(): Promise<Map<string, BgTranslation>> {
  const path = resolve(BACKEND_ROOT, BG_TRANSLATIONS_FILE);
  const raw = JSON.parse(await readFile(path, 'utf8')) as Record<string, BgTranslation>;
  const translations = new Map<string, BgTranslation>();

  for (const [fdcId, entry] of Object.entries(raw)) {
    if (fdcId.startsWith('_')) continue; // documentation block
    if (!entry?.bg || !Array.isArray(entry.head)) continue;
    translations.set(fdcId, entry);
  }

  return translations;
}

interface BgTerms {
  /** One English word → its Bulgarian forms. */
  single: Map<string, string[]>;
  /** All of `tokens` must be present in the name before `bulgarian` applies. */
  phrases: { tokens: string[]; bulgarian: string[] }[];
}

/**
 * Load the English→Bulgarian food term dictionary.
 *
 * Keys are run through `tokenize` on load so the dictionary matches food names under
 * exactly the same singularization, and a key written as "tomatoes" still works. A key
 * with more than one word becomes a phrase rule. `_comment` is documentation inside the
 * JSON file and is skipped.
 */
async function loadBgTerms(): Promise<BgTerms> {
  const path = resolve(BACKEND_ROOT, BG_TERMS_FILE);
  const raw = JSON.parse(await readFile(path, 'utf8')) as Record<string, string[]>;
  const terms: BgTerms = { single: new Map(), phrases: [] };

  for (const [english, bulgarian] of Object.entries(raw)) {
    if (english.startsWith('_') || !Array.isArray(bulgarian)) continue;

    const keyTokens = tokenize(english);
    const forms = bulgarian.map((term) => term.toLowerCase());
    if (keyTokens.length === 0) continue;

    if (keyTokens.length > 1) {
      terms.phrases.push({ tokens: keyTokens, bulgarian: forms });
      continue;
    }

    const key = keyTokens[0]!;
    terms.single.set(key, [...new Set([...(terms.single.get(key) ?? []), ...forms])]);
  }

  return terms;
}

/**
 * Seed value for the search boost, so the plain entry wins its own name: "Bananas, raw"
 * should outrank "Bananas, dehydrated" for the query "banana" before any query-specific
 * scoring runs. Small numbers — this breaks ties, it does not decide matches, and the
 * column stays hand-tunable afterwards.
 */
function computeRank(name: string): number {
  const tokens = tokenize(name);
  let rank = 0;

  // The unmodified form of a food is the one people mean by its bare name.
  if (tokens.includes('raw')) rank += 1;

  // "Egg, whole" is what someone typing "egg" means; "Egg, yolk" is a component of it.
  // Without this the three egg rows score identically and the tie falls to name length,
  // which handed the query to the yolk (322 kcal) over the whole egg (143) by one
  // character. A part is still findable, just not the default answer.
  if (tokens.includes('whole')) rank += 1;
  rank -= tokens.filter((token) => PART_MARKERS.has(token)).length;

  rank -= tokens.filter((token) => PROCESSED_MARKERS.has(token)).length * 2;
  rank -= tokens.filter((token) => VARIANT_MARKERS.has(token)).length;

  // Two bonuses that sound right and measurably are not, both removed after testing:
  //
  // "fewer commas = more generic" rewarded "Rose-apples, raw" and "Wild rice, raw" for
  // being short, pushing them above "Apples, raw, with skin" and "Rice, white,
  // long-grain, raw". Short names are not more generic, only shorter.
  //
  // "Foundation +2" (which `fdc.ts` uses, correctly, for the live API) backfires over the
  // full dataset: Foundation catalogues specific cultivars while the plain generic entry
  // usually lives in SR Legacy, so it promoted "Apples, fuji, with skin, raw" (64.7) over
  // "Apples, raw, with skin" (52) and "Bananas, overripe, raw" over "Bananas, raw". The
  // two datasets' macros agree closely enough that naming should decide, not provenance.
  //
  // What is left is only what the NAME says about the food. Everything query-dependent —
  // head noun, exact vs prefix, unasked-for words — belongs at query time, not here.
  return rank;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

interface Options {
  strict: boolean;
}

/** Rejections worth showing an example of, rather than only counting. */
interface Rejections {
  processed: string[];
  branded: string[];
  noEnergy: string[];
  outOfRange: string[];
}

async function importFoods(options: Options) {
  const stats: Stats = {
    total: 0,
    categoryRejected: 0,
    noEnergy: 0,
    outOfRange: 0,
    malformed: 0,
    duplicate: 0,
    processed: 0,
    branded: 0,
    kept: 0,
  };
  const rejections: Rejections = { processed: [], branded: [], noEnergy: [], outOfRange: [] };
  const seenCategories = new Map<string, number>();
  const keptByCategory = new Map<string, number>();
  const rows: SeedRow[] = [];
  const seenIds = new Set<string>();
  const bgTerms = await loadBgTerms();
  const bgTranslations = await loadBgTranslations();

  for (const source of SOURCES) {
    const path = resolve(BACKEND_ROOT, source);

    for await (const raw of streamFoodObjects(path)) {
      stats.total++;
      const food = JSON.parse(raw) as BulkFood;

      const category = food.foodCategory?.description;
      if (category) seenCategories.set(category, (seenCategories.get(category) ?? 0) + 1);

      if (!category || !CATEGORY_ALLOWLIST.has(category)) {
        stats.categoryRejected++;
        continue;
      }

      const { fdcId, description } = food;
      if (typeof fdcId !== 'number' || !description) {
        stats.malformed++;
        continue;
      }

      // Energy first: this is the filter that silently emptied the result set once.
      // Foundation foods publish 957/958 and no 208 at all, so anything reading only
      // 208 drops every Foundation row without erroring.
      const nutrients = food.foodNutrients ?? [];
      const kcal = readEnergy(nutrients);
      if (kcal === null) {
        stats.noEnergy++;
        if (rejections.noEnergy.length < 5) rejections.noEnergy.push(description);
        continue;
      }

      const per100g: Per100g = {
        kcal,
        protein: readMacro(nutrients, NUTRIENTS.protein),
        fat: readMacro(nutrients, NUTRIENTS.fat),
        carbs: readMacro(nutrients, NUTRIENTS.carbs),
      };

      // The same bounds as the table's CHECK constraints — a row failing here would be
      // rejected by Postgres at seed time anyway, so drop it now with a reason attached.
      if (!inRange(per100g)) {
        stats.outOfRange++;
        if (rejections.outOfRange.length < 5) {
          rejections.outOfRange.push(`${description} → ${JSON.stringify(per100g)}`);
        }
        continue;
      }

      const name = cleanName(description);
      if (!name) {
        stats.malformed++;
        continue;
      }

      const tokens = tokenize(name);
      const isProcessed = tokens.some((token) => PROCESSED_MARKERS.has(token));
      const isBranded = hasBrandToken(name);

      if (isProcessed) {
        stats.processed++;
        if (rejections.processed.length < 8) rejections.processed.push(name);
      }
      if (isBranded) {
        stats.branded++;
        if (rejections.branded.length < 8) rejections.branded.push(name);
      }
      if (options.strict && (isProcessed || isBranded)) continue;

      // UNIQUE (source, external_id) — catch collisions here rather than at seed time.
      const externalId = String(fdcId);
      if (seenIds.has(externalId)) {
        stats.duplicate++;
        continue;
      }
      seenIds.add(externalId);

      // Every Bulgarian name is hand-written now. A row with no entry keeps its English
      // name — better than a half-translated one, which reads as a different food.
      const translation = bgTranslations.get(externalId);
      const nameBg = translation?.bg ?? null;

      const portions = readPortions(food.foodPortions);
      rows.push({
        source: 'usda',
        externalId,
        name,
        nameBg,
        searchText: buildSearchText(name, nameBg, bgTerms, translation),
        category,
        kcalPer100g: per100g.kcal,
        proteinPer100g: per100g.protein,
        carbsPer100g: per100g.carbs,
        fatPer100g: per100g.fat,
        servingSizeG: pickServingSize(portions),
        portions,
        rank: computeRank(name),
      });

      stats.kept++;
      keptByCategory.set(category, (keptByCategory.get(category) ?? 0) + 1);
    }
  }

  // Stable order so the committed file diffs cleanly across re-imports.
  rows.sort((a, b) => a.externalId.localeCompare(b.externalId, 'en', { numeric: true }));

  return { stats, rows, rejections, seenCategories, keptByCategory };
}

async function writeSeed(rows: SeedRow[]): Promise<string> {
  const path = resolve(BACKEND_ROOT, OUTPUT_FILE);
  await mkdir(dirname(path), { recursive: true });

  const out = createWriteStream(path, { encoding: 'utf8' });
  for (const row of rows) {
    if (!out.write(`${JSON.stringify(row)}\n`)) {
      await new Promise((done) => out.once('drain', done));
    }
  }
  await new Promise<void>((done, fail) => {
    out.end(() => done());
    out.on('error', fail);
  });

  return path;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/**
 * Known values that catch the failure modes this importer exists to avoid, each paired
 * with its Bulgarian equivalent: a query must find the same food in either language, so
 * a missing dictionary entry shows up here as "NO MATCHES" rather than in production.
 */
const VERIFY = [
  { query: 'banana', bg: 'банан', expect: '~89 kcal' },
  { query: 'olive oil', bg: 'зехтин', expect: '~884 kcal' },
  { query: 'chicken breast raw', bg: 'пилешко филе', expect: '~120 kcal' },
  { query: 'tomato', bg: 'домат', expect: '~18 kcal — 302 means the tomato-powder bug is back' },
  { query: 'apple', bg: 'ябълка', expect: '~52 kcal' },
  { query: 'egg', bg: 'яйце', expect: '~143 kcal' },
  { query: 'rice', bg: 'ориз', expect: 'raw white rice ~360 kcal' },
  { query: 'cheese', bg: 'сирене', expect: 'a real cheese, not a substitute' },
];

/**
 * A realistic sample of what people log, in both languages — used to measure how much of
 * what search actually surfaces carries a Bulgarian display name.
 */
const COMMON_QUERIES = [
  'banana',
  'apple',
  'pear',
  'orange',
  'strawberry',
  'grape',
  'watermelon',
  'peach',
  'tomato',
  'cucumber',
  'potato',
  'carrot',
  'onion',
  'pepper',
  'broccoli',
  'spinach',
  'cabbage',
  'mushroom',
  'egg',
  'milk',
  'cheese',
  'yogurt',
  'butter',
  'cream',
  'chicken breast',
  'beef',
  'pork',
  'turkey',
  'salmon',
  'tuna',
  'shrimp',
  'rice',
  'oat',
  'bread',
  'pasta',
  'flour',
  'bean',
  'lentil',
  'chickpea',
  'walnut',
  'almond',
  'peanut',
  'olive oil',
  'sunflower oil',
  'honey',
  'salt',
  'банан',
  'ябълка',
  'домат',
  'краставица',
  'картоф',
  'яйце',
  'сирене',
  'кисело мляко',
  'пилешко филе',
  'ориз',
  'леща',
  'зехтин',
  'орех',
  'мед',
];

function report(result: Awaited<ReturnType<typeof importFoods>>, options: Options) {
  const { stats, rows, rejections, seenCategories, keptByCategory } = result;
  const pct = (n: number) => `${((n / stats.total) * 100).toFixed(1)}%`;

  console.log(`\n${'='.repeat(72)}`);
  console.log(`FILTER RESULTS${options.strict ? '  (--strict)' : ''}`);
  console.log('='.repeat(72));
  console.log(`  read from both dumps      ${String(stats.total).padStart(6)}`);
  console.log(
    `  dropped: category         ${String(stats.categoryRejected).padStart(6)}  ${pct(stats.categoryRejected)}`,
  );
  console.log(`  dropped: no energy        ${String(stats.noEnergy).padStart(6)}`);
  console.log(`  dropped: out of range     ${String(stats.outOfRange).padStart(6)}`);
  console.log(`  dropped: malformed        ${String(stats.malformed).padStart(6)}`);
  console.log(`  dropped: duplicate id     ${String(stats.duplicate).padStart(6)}`);
  console.log(`  ${'-'.repeat(40)}`);
  console.log(`  KEPT                      ${String(stats.kept).padStart(6)}  ${pct(stats.kept)}`);

  console.log(`\n--- Kept by category ---`);
  for (const [category, count] of [...keptByCategory].sort((a, b) => b[1] - a[1])) {
    const available = seenCategories.get(category) ?? 0;
    console.log(`  ${String(count).padStart(5)} / ${String(available).padEnd(5)} ${category}`);
  }

  console.log(`\n--- Excluded categories ---`);
  for (const [category, count] of [...seenCategories].sort((a, b) => b[1] - a[1])) {
    if (CATEGORY_ALLOWLIST.has(category)) continue;
    console.log(`  ${String(count).padStart(5)} ${category}`);
  }

  console.log(
    `\n--- Marker flags among kept rows ${options.strict ? '(dropped)' : '(NOT dropped — pass --strict to drop)'} ---`,
  );
  console.log(`  processed-derivative markers  ${String(stats.processed).padStart(5)}`);
  rejections.processed.forEach((n) => console.log(`      ${n}`));
  console.log(`  ALL-CAPS brand token          ${String(stats.branded).padStart(5)}`);
  rejections.branded.forEach((n) => console.log(`      ${n}`));

  if (rejections.noEnergy.length) {
    console.log(`\n--- Sample: no readable energy ---`);
    rejections.noEnergy.forEach((n) => console.log(`      ${n}`));
  }
  if (rejections.outOfRange.length) {
    console.log(`\n--- Sample: failed inRange() ---`);
    rejections.outOfRange.forEach((n) => console.log(`      ${n}`));
  }

  const withBg = rows.filter((row) => /[Ѐ-ӿ]/.test(row.searchText)).length;
  const named = rows.filter((row) => row.nameBg !== null);
  console.log(`\n--- Bulgarian coverage ---`);
  console.log(
    `  findable  (a Bulgarian term in search_text)  ${withBg} / ${rows.length}` +
      `  (${((withBg / rows.length) * 100).toFixed(1)}%)`,
  );
  console.log(
    `  displayed (has a name_bg)                   ${named.length} / ${rows.length}` +
      `  (${((named.length / rows.length) * 100).toFixed(1)}%)`,
  );
  // Two foods sharing one Bulgarian name means the translation dropped something that
  // distinguished them — a correctness bug, not a coverage gap, so it is loud.
  const byBgName = new Map<string, string[]>();
  for (const row of named) {
    byBgName.set(row.nameBg!, [...(byBgName.get(row.nameBg!) ?? []), row.name]);
  }
  const collisions = [...byBgName]
    .map(([bg, english]) => [bg, [...new Set(english)]] as const)
    .filter(([, english]) => english.length > 1);
  console.log(`  COLLISIONS (same name_bg, different foods): ${collisions.length}`);
  for (const [bg, english] of collisions.slice(0, 5)) {
    console.log(`      "${bg}"  ←  ${english.join('  |  ')}`);
  }

  // Raw coverage understates what a user experiences: the untranslated tail is mostly
  // butchery jargon ("Beef, chuck, arm pot roast, separable lean only, trimmed to 1/8\"
  // fat, choice") that ranks low and is rarely picked. What matters is how much of what
  // actually SURFACES carries a Bulgarian name.
  const surfaced = COMMON_QUERIES.flatMap((q) => search(rows, q, 5));
  const surfacedNamed = surfaced.filter((row) => row.nameBg !== null).length;
  console.log(
    `  displayed among TOP-5 RESULTS for ${COMMON_QUERIES.length} common queries` +
      `   ${surfacedNamed} / ${surfaced.length}` +
      `  (${surfaced.length ? ((surfacedNamed / surfaced.length) * 100).toFixed(1) : '0'}%)`,
  );

  console.log(`  sample Bulgarian names:`);
  for (const row of named.slice(0, 12)) {
    console.log(`      ${row.name}\n        → ${row.nameBg}`);
  }

  // Spot check: rank the kept rows the way search will, so the report shows what a
  // user typing these words would actually get — in BOTH languages.
  console.log(`\n--- Verification (top 2 by rank, then fewest extra words) ---`);
  for (const { query, bg, expect } of VERIFY) {
    console.log(`\n  "${query}" / "${bg}"  (expect ${expect})`);
    for (const term of [query, bg]) {
      const hits = search(rows, term);
      if (hits.length === 0) {
        console.log(
          `      [${term}] NO MATCHES  ← ${bg === term ? 'missing bg-food-terms entry' : ''}`,
        );
        continue;
      }
      for (const row of hits) {
        console.log(
          `      [${term}] ${String(row.kcalPer100g).padStart(6)} kcal   ${row.name}` +
            `
              bg: ${row.nameBg ?? '— (falls back to English)'}`,
        );
      }
    }
  }
}

/** The report ranks with the SAME code the endpoint uses — see services/food-search.ts. */
function search(rows: SeedRow[], term: string, limit = 2): SeedRow[] {
  return rankFoods(rows, term, limit);
}

// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const options: Options = { strict: args.includes('--strict') };
  const reportOnly = args.includes('--report');

  const started = Date.now();
  const result = await importFoods(options);
  report(result, options);

  console.log(
    `\nParsed ${result.stats.total} records in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );

  if (reportOnly) {
    console.log(`--report: nothing written.`);
    return;
  }

  const path = await writeSeed(result.rows);
  console.log(`Wrote ${result.rows.length} rows → ${path}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
