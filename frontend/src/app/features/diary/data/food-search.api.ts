import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { map, type Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';
import type { Language } from '../../../core/i18n/translations';
import type { FoodSearchResult } from '../models/food-search.models';

// Open Food Facts product search. Their docs point text search at the dedicated
// Search-a-licious service, but that host sends no CORS headers, so a browser can't
// call it — the legacy v1 search below is the one OFF endpoint that does full-text
// search AND allows cross-origin calls. It also returns nutriments in the same
// response, so a settled query costs a single request (their search rate limit is
// ~10/min/IP; the overlay additionally debounces, deduplicates, and caches).
// Dev builds hit OFF's staging host, production builds the real database — see
// environments/. The absolute URL doesn't start with the app's `/api` base, so the
// auth interceptor leaves these requests untouched.
const PAGE_SIZE = 20;

// OFF asks apps to identify themselves. Browsers reserve the real User-Agent
// header, but OFF's CORS policy explicitly allows X-User-Agent instead.
const APP_USER_AGENT = 'CalorieTracker/1.0 (maxim.kraychev@gmail.com)';

type Nutriments = Partial<Record<string, number>>;

// v1 search product (only the fields we request). `product_name` is localized via
// `lc`; `brands` is a comma-separated string. `nutriments` holds label data;
// `nutriments_estimated` is OFF's ingredient-based estimate, present for unlabelled
// products (fresh produce).
interface Product {
  code?: string;
  product_name?: string;
  brands?: string;
  nutriments?: Nutriments;
  nutriments_estimated?: Nutriments;
}

interface SearchResponse {
  products?: Product[];
}

@Service()
export class FoodSearchApi {
  private readonly http = inject(HttpClient);

  private readonly headers: Record<string, string> = {
    'X-User-Agent': APP_USER_AGENT,
    // Staging only: a fixed shared credential OFF uses to keep crawlers out.
    ...(environment.off.basicAuth
      ? { Authorization: `Basic ${btoa(environment.off.basicAuth)}` }
      : {}),
  };

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
      fields: 'code,product_name,brands,nutriments,nutriments_estimated',
    };
    return this.http.get<SearchResponse>(environment.off.searchUrl, { params, headers: this.headers }).pipe(
      map((response) =>
        (response.products ?? []).flatMap((product) => {
          const result = toResult(product);
          return result ? [result] : [];
        }),
      ),
    );
  }
}

// Products without a usable name or kcal value are dropped rather than shown as 0 kcal.
function toResult(product: Product): FoodSearchResult | null {
  const name = product.product_name?.trim();
  const nutriments = pickNutriments(product);
  if (!product.code || !name || !nutriments) return null;
  return {
    code: product.code,
    name,
    brand: product.brands?.split(',')[0]?.trim() || null,
    kcalPer100g: nutriments['energy-kcal_100g']!,
    proteinPer100g: nutriments['proteins_100g'] ?? 0,
    carbsPer100g: nutriments['carbohydrates_100g'] ?? 0,
    fatPer100g: nutriments['fat_100g'] ?? 0,
  };
}

// Label data first, OFF's estimate as fallback; null when neither has a kcal value.
function pickNutriments(product: Product): Nutriments | null {
  for (const nutriments of [product.nutriments, product.nutriments_estimated]) {
    if (typeof nutriments?.['energy-kcal_100g'] === 'number') return nutriments;
  }
  return null;
}
