// Ranking for the whole-food catalog.
//
// Shared by `modules/foods` (the live endpoint) and `scripts/import-generic-foods.ts`
// (whose report proves the seed data supports it). Two copies would drift, and the
// failure is invisible: the report would keep claiming "banana → 89 kcal" while
// production returned something else.
//
// The three signals below were each arrived at by measurement, and two of them replaced
// heuristics that sounded obviously right and were not — see the notes on `computeRank`
// in the importer.

import { tokenizeQuery, wordMatch, matchesHeadTerm } from './fdc-text.js';

/** The minimum a row must expose to be ranked. */
export interface RankableFood {
  name: string;
  /**
   * The Bulgarian name, when the catalog has one. Used only to measure how many words
   * the query did NOT ask for: against a Cyrillic query, every token of the English name
   * counts as unasked-for, which turns that penalty into pure name-length bias and lets
   * a short obscure entry beat the right one.
   */
  nameBg?: string | null;
  /** `head, terms | full name and synonyms`, built by the importer. */
  searchText: string;
  /** The seeded specificity boost stored on the row. */
  rank: number;
}

/**
 * A whole-word hit is worth far more than a mere prefix hit. This is what keeps
 * "Eggplant, raw" below "Egg, whole, raw, fresh" for the query "egg" — matching has to
 * allow prefixes so "tomato" reaches "tomatoes", which lets "egg" reach "eggplant" too.
 */
const EXACT_MATCH = 6;

/**
 * The name STARTS with what was asked for. USDA descriptions read
 * "HeadNoun, qualifier, qualifier", so the head noun says what the food *is*:
 * "Apples, raw, with skin" is an apple, "Rose-apples, raw" is a different fruit whose
 * name merely contains the word. The single most reliable signal here.
 */
const HEAD_NOUN = 4;

/**
 * Every word of the name the query did not ask for, at half weight — enough to prefer
 * the plainest entry among equals, not enough to let a vague short name beat a precise
 * long one ("Rice, white, long-grain, raw" must survive its five qualifiers).
 */
const EXTRA_WORD = 0.5;

/**
 * Score one food against a tokenized query. Higher is better; `null` means it does not
 * match at all and must not be returned.
 *
 * The scale is arbitrary and only comparable within a single result set.
 */
export function scoreFood(food: RankableFood, queryTokens: string[]): number | null {
  if (queryTokens.length === 0) return null;

  const matches = queryTokens.map((token) => wordMatch(food.searchText, token));
  if (matches.some((match) => match === null)) return null;

  const exact = matches.filter((match) => match === 'exact').length * EXACT_MATCH;

  const firstToken = queryTokens[0];
  const isHeadNoun = firstToken !== undefined && matchesHeadTerm(food.searchText, firstToken);

  // Count unasked-for words against whichever name the query is actually written in —
  // the smaller of the two. Measuring a Bulgarian query against the English name scores
  // every English word as an extra, which is name length wearing a disguise.
  const wanted = new Set(queryTokens);
  const countExtras = (text: string) =>
    tokenizeQuery(text).filter((token) => !wanted.has(token)).length;
  const extras = Math.min(
    countExtras(food.name),
    food.nameBg ? countExtras(food.nameBg) : Number.POSITIVE_INFINITY,
  );

  return (isHeadNoun ? HEAD_NOUN : 0) + exact + food.rank - extras * EXTRA_WORD;
}

/**
 * Rank a candidate pool, best first, dropping non-matches.
 *
 * Ties break on the row's own `rank` then name length, so results are stable across
 * requests instead of falling back to whatever order Postgres returned.
 */
export function rankFoods<T extends RankableFood>(foods: T[], query: string, limit: number): T[] {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return [];

  return foods
    .map((food) => ({ food, score: scoreFood(food, tokens) }))
    .filter((entry): entry is { food: T; score: number } => entry.score !== null)
    .sort(
      (a, b) =>
        b.score - a.score || b.food.rank - a.food.rank || a.food.name.length - b.food.name.length,
    )
    .slice(0, limit)
    .map((entry) => entry.food);
}
