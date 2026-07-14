// Dev values — `ng serve` swaps this file in via fileReplacements (angular.json).
// Relative /api so the dev-server proxy (proxy.conf.json) forwards requests
// to the local Express backend without any CORS involvement.
export const environment = {
  apiBaseUrl: '/api',
};
