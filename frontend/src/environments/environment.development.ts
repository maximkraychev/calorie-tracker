// Dev values — `ng serve` swaps this file in via fileReplacements (angular.json).
// Relative /api so the dev-server proxy (proxy.conf.json) forwards requests
// to the local Express backend without any CORS involvement.
export const environment = {
  apiBaseUrl: '/api',
  // Open Food Facts staging, per their docs ("while testing your applications,
  // make all API requests to the staging environment"). Staging sits behind a
  // fixed off:off basic auth purely to keep search engines out.
  off: {
    searchUrl: 'https://world.openfoodfacts.net/cgi/search.pl',
    // v2 product-by-barcode base; the scanner appends `/api/v2/product/{code}.json`.
    productUrl: 'https://world.openfoodfacts.net',
    basicAuth: 'off:off' as string | null,
  },
};
