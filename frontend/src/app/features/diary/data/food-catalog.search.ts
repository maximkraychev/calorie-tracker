import { inject, Service } from '@angular/core';
import { catchError, combineLatest, map, of, type Observable } from 'rxjs';

import type { Language } from '../../../core/i18n/translations';
import type { FoodSearchResult } from '../models/food-search.models';
import { FoodSearchApi } from './food-search.api';
import { GenericFoodsApi } from './generic-foods.api';

// "A food search" in this app means both catalogs at once: our USDA-seeded whole-food
// table and Open Food Facts. It lives here rather than in one overlay because two
// screens run it — the Add-Food search pane and the photo estimate's add-ingredient
// field — and a search that behaves differently depending on which screen you opened it
// from is a bug waiting to happen.
//
// Callers own the debounce and the loading/empty/error states; this only answers a
// settled query.

@Service()
export class FoodCatalogSearch {
  private readonly generic = inject(GenericFoodsApi);
  private readonly off = inject(FoodSearchApi);

  // Settled query → merged results, for the life of the session. Serves repeats and
  // back-and-forth typing without re-hitting OFF (which rate-limits per IP at ~10/min),
  // and because it is a singleton the two screens warm the same cache. Errors are never
  // cached, so a retry really retries.
  private readonly cache = new Map<string, FoodSearchResult[]>();

  search(query: string, lang: Language): Observable<FoodSearchResult[]> {
    const key = `${lang}:${query.toLowerCase()}`;
    const cached = this.cache.get(key);
    if (cached) return of(cached);

    // Both catalogs in parallel, and neither is allowed to sink the other: Open Food
    // Facts is a third party that rate-limits and 503s, and our own endpoint sits on a
    // free instance that cold-starts. A failed source contributes an empty list, so the
    // surviving one still renders.
    return combineLatest([
      this.generic.search(query).pipe(catchError(() => of<FoodSearchResult[]>([]))),
      this.off.search(query, lang).pipe(catchError(() => of<FoodSearchResult[]>([]))),
    ]).pipe(
      map(([generic, off]) => {
        const results = mergeResults(generic, off, query);
        this.cache.set(key, results);
        return results;
      }),
    );
  }
}

// A token only a packaged product would carry: a digit ("coca cola 330") or a unit of
// packaging. Their presence says the user wants a specific product, not an ingredient.
//
// The word boundaries are load-bearing. Without them the single-letter alternatives
// match inside ordinary words — "l" hits app(l)e, mi(l)k and sa(l)t — so every fruit
// query would be misread as a brand search and answered by Open Food Facts first.
const BRAND_HINT = /\d|\b(ml|l|g|kg|oz|pack|bar|bio|zero|light|max)\b/i;

/**
 * Interleave the two catalogs.
 *
 * The query itself says which one the user meant. "banana" or "chicken breast" is an
 * ingredient — the whole-food catalog answers it well and OFF answers it with
 * banana-flavoured cereal bars. Anything longer, or carrying a digit or a packaging
 * word, is someone looking for a product on a shelf, and OFF is the better first answer.
 *
 * The loser is appended rather than dropped: both lists stay reachable by scrolling, so
 * a wrong guess costs the user a scroll instead of a re-query.
 */
export function mergeResults(
  generic: FoodSearchResult[],
  off: FoodSearchResult[],
  query: string,
): FoodSearchResult[] {
  const words = query.trim().split(/\s+/).filter(Boolean);
  const wholeFoodQuery = words.length <= 2 && !BRAND_HINT.test(query);

  const ordered = wholeFoodQuery ? [...generic, ...off] : [...off, ...generic];

  // `code` is namespaced per source, so this only removes a genuine repeat within one.
  const seen = new Set<string>();
  return ordered.filter((result) => !seen.has(result.code) && seen.add(result.code));
}
