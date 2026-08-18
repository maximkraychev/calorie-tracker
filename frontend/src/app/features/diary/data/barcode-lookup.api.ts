import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { catchError, map, of, throwError, type Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';
import type { Language } from '../../../core/i18n/translations';
import type { FoodSearchResult } from '../models/food-search.models';
import { toResult, type Product } from './off-product';

// Open Food Facts barcode lookup. Uses the v2 product endpoint OFF recommends for
// scanning (`/api/v2/product/{code}.json`) — it's CORS-open and returns nutriments in
// one request, so a scan settles in a single call. Kept browser-direct for the same
// reason as search: OFF rate limits per IP, so every user gets their own bucket
// (see off-search.api.ts). Dev builds hit OFF's staging host, production the real
// database — via `environment.off.productUrl`.
//
// We do NOT normalize the barcode: OFF's docs are explicit that the server pads/checks
// it, so we pass the scanned digits through as-is.

// v2 wraps the product in a status envelope: `status: 1` = found, `status: 0` = not
// found (unknown barcode). We only read the fields we requested. Note that v2 sends the
// `status: 0` envelope under an HTTP **404** for a barcode it has never seen, and under a
// 200 for one it considers malformed — so both the body and the status code have to be
// read to tell "no such product" apart from a real failure.
interface ProductResponse {
  status?: number;
  product?: Product;
}

@Service()
export class BarcodeLookupApi {
  private readonly http = inject(HttpClient);

  // Same rationale as search: no custom X-User-Agent so the GET stays a CORS-simple
  // request (no OPTIONS preflight, which OFF's prod host tends to 503 under load). The
  // real browser UA still identifies low-volume reads. Staging keeps the Basic
  // credential (dev only) — it forces a preflight, but staging is lightly loaded.
  private readonly headers: Record<string, string> = environment.off.basicAuth
    ? { Authorization: `Basic ${btoa(environment.off.basicAuth)}` }
    : {};

  /** Look up a scanned barcode. Resolves to null when OFF has no such product. */
  lookup(code: string, lang: Language): Observable<FoodSearchResult | null> {
    const url = `${environment.off.productUrl}/api/v2/product/${encodeURIComponent(code)}.json`;
    const params = {
      lc: lang,
      fields:
        'code,product_name,brands,nova_group,nutriments,nutriments_estimated,image_front_small_url,image_small_url',
    };
    return this.http.get<ProductResponse>(url, { params, headers: this.headers }).pipe(
      map((response) =>
        response.status === 1 && response.product ? toResult(response.product) : null,
      ),
      // An unknown barcode arrives as a 404, which HttpClient raises as an error even
      // though it is a perfectly normal answer. Fold it into the same `null` the
      // 200-with-`status: 0` case produces, so the scanner says "not found · scan
      // again" instead of reporting a scan failure. Anything else is a genuine fault
      // and still throws.
      catchError((error: unknown) =>
        error instanceof HttpErrorResponse && error.status === 404
          ? of(null)
          : throwError(() => error),
      ),
    );
  }
}
