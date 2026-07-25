// Production values — this is what `ng build` ships by default.
// Relative /api: the deployed frontend (Render Static Site) proxies /api/* to
// the backend via a rewrite rule, so the browser sees one origin. This keeps
// the auth cookie first-party (works on Safari/iOS) and avoids CORS entirely.
export const environment = {
  apiBaseUrl: '/api',
  // Open Food Facts production. Public read API — no auth needed.
  off: {
    searchUrl: 'https://world.openfoodfacts.org/cgi/search.pl',
    // v2 product-by-barcode base; the scanner appends `/api/v2/product/{code}.json`.
    productUrl: 'https://world.openfoodfacts.org',
    basicAuth: null as string | null,
  },
};
