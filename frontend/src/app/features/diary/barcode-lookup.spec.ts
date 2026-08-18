import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { BarcodeLookupApi } from './data/barcode-lookup.api';
import type { FoodSearchResult } from './models/food-search.models';

describe('BarcodeLookupApi', () => {
  let api: BarcodeLookupApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(BarcodeLookupApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /** Subscribe and capture whatever the lookup settles on, success or failure. */
  function lookup(code: string) {
    const seen: { result?: FoodSearchResult | null; failed?: boolean } = {};
    api.lookup(code, 'en').subscribe({
      next: (result) => (seen.result = result),
      error: () => (seen.failed = true),
    });
    return seen;
  }

  it('maps a found product, including its photo', () => {
    const seen = lookup('3017620422003');
    http
      .expectOne((request) => request.url.includes('/api/v2/product/3017620422003.json'))
      .flush({
        status: 1,
        product: {
          code: '3017620422003',
          product_name: 'Nutella',
          brands: 'Ferrero',
          nutriments: {
            'energy-kcal_100g': 539,
            proteins_100g: 6.3,
            carbohydrates_100g: 57.5,
            fat_100g: 30.9,
          },
          image_front_small_url: 'https://images.openfoodfacts.org/front_en.200.jpg',
        },
      });

    expect(seen.result?.name).toBe('Nutella');
    expect(seen.result?.imageUrl).toBe('https://images.openfoodfacts.org/front_en.200.jpg');
  });

  // The regression this guards: OFF answers an unknown barcode with a 404, which
  // HttpClient raises as an error. Before it was folded into `null`, the scanner reported
  // a scan failure ("something went wrong") for every barcode OFF simply doesn't carry.
  it('treats an unknown barcode (404) as not found, not an error', () => {
    const seen = lookup('4062300000000');
    http
      .expectOne((request) => request.url.includes('/api/v2/product/4062300000000.json'))
      .flush(
        { code: '4062300000000', status: 0, status_verbose: 'product not found' },
        { status: 404, statusText: 'Not Found' },
      );

    expect(seen.result).toBeNull();
    expect(seen.failed).toBeUndefined();
  });

  // A malformed code comes back 200 with the same `status: 0` envelope.
  it('treats a 200 with status 0 as not found', () => {
    const seen = lookup('00000000');
    http
      .expectOne((request) => request.url.includes('/api/v2/product/00000000.json'))
      .flush({ code: '00000000', status: 0, status_verbose: 'no code or invalid code' });

    expect(seen.result).toBeNull();
    expect(seen.failed).toBeUndefined();
  });

  // Anything that isn't a 404 is a real fault and must still surface as one, so the
  // scanner keeps showing its error state for a genuinely broken request.
  it('still errors on a server failure', () => {
    const seen = lookup('3017620422003');
    http
      .expectOne((request) => request.url.includes('/api/v2/product/3017620422003.json'))
      .flush('upstream down', { status: 503, statusText: 'Service Unavailable' });

    expect(seen.failed).toBe(true);
    expect(seen.result).toBeUndefined();
  });
});
