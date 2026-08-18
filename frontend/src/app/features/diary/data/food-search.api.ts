import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { map, type Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';
import type { Language } from '../../../core/i18n/translations';
import type { FoodSearchResult } from '../models/food-search.models';
import { toResult, type Product } from './off-product';

// Open Food Facts product search. Their docs point text search at the dedicated
// Search-a-licious service, but that host sends no CORS headers, so a browser can't
// call it — the legacy v1 search below is the one OFF endpoint that does full-text
// search AND allows cross-origin calls. It also returns nutriments in the same
// response, so a settled query costs a single request (their search rate limit is
// ~10/min/IP; the overlay additionally debounces, deduplicates, and caches).
// Dev builds hit OFF's staging host, production builds the real database — see
// environments/. The absolute URL doesn't start with the app's `/api` base, so the
// auth interceptor leaves these requests untouched.
//
// OFF sorts by scan popularity, which buries generic/raw foods (a plain banana)
// under branded packaged goods (banana-flavoured bars, yoghurts). Popularity also
// decides *which* products come back, so we can't just reorder 20 — we fetch a wider
// pool and re-rank it locally (see rankResults), then show the top DISPLAY_SIZE.
const PAGE_SIZE = 50;
const DISPLAY_SIZE = 20;

interface SearchResponse {
  products?: Product[];
}

@Service()
export class FoodSearchApi {
  private readonly http = inject(HttpClient);

  // A GET carrying only CORS-"simple" headers skips the preflight (OPTIONS) hop.
  // OFF's production host frequently 503s that preflight under load, which then
  // blocks the GET, so we send no custom X-User-Agent from the browser: the real
  // browser UA still identifies us, and OFF permits low-volume reads without it.
  // Staging keeps the Basic credential (dev builds only) — it forces a preflight,
  // but staging is lightly loaded so that's fine.
  private readonly headers: Record<string, string> = environment.off.basicAuth
    ? { Authorization: `Basic ${btoa(environment.off.basicAuth)}` }
    : {};

  search(query: string, lang: Language): Observable<FoodSearchResult[]> {
    const params = {
      search_terms: query,
      search_simple: 1,
      action: 'process',
      json: 1,
      page_size: PAGE_SIZE,
      lc: lang,
      // Most-scanned products first — the closest thing v1 has to relevance.
      sort_by: 'unique_scans_n',
      fields:
        'code,product_name,brands,nova_group,nutriments,nutriments_estimated,image_front_small_url,image_small_url',
    };
    return this.http
      .get<SearchResponse>(environment.off.searchUrl, { params, headers: this.headers })
      .pipe(map((response) => rankResults(response.products ?? [], query)));
  }
}

// OFF returns the pool ordered by scan popularity; we re-rank it toward what the
// user most likely meant — the query as a whole word, near the start of a terse
// name, for an unprocessed food — then keep the top DISPLAY_SIZE. Ties preserve
// OFF's original order (Array.sort is stable), so popularity still breaks ties.
function rankResults(products: Product[], query: string): FoodSearchResult[] {
  const q = query.trim().toLowerCase();
  return products
    .flatMap((product) => {
      const result = toResult(product);
      return result ? [{ result, score: scoreOf(result, product, q) }] : [];
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, DISPLAY_SIZE)
    .map((scored) => scored.result);
}

// Higher = more relevant. Word split is Unicode-aware so it works for Cyrillic too.
function scoreOf(result: FoodSearchResult, product: Product, query: string): number {
  const name = result.name.toLowerCase();
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  let score = 0;

  // Name-match tightness: the query as the whole name, then as a prefix, then as a
  // standalone word ("banana nectar"), then merely somewhere inside a longer word.
  if (name === query) score += 100;
  else if (name.startsWith(query)) score += 60;
  else if (words.includes(query)) score += 30;
  else if (name.includes(query)) score += 10;

  // Brevity: raw/generic foods have terse names; packaged products are wordy.
  score += Math.max(0, 12 - words.length * 2);

  // Processing level: NOVA 1 is unprocessed (raw fruit/veg) — the whole-food boost.
  if (product.nova_group === 1) score += 40;
  else if (product.nova_group === 2) score += 15;

  return score;
}
