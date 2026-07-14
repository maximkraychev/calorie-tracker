import { InjectionToken } from '@angular/core';

// Base URL every `*.api.ts` service builds on. In dev the Angular server proxies
// `/api` → the Express backend (see proxy.conf.json), so no host is ever hardcoded.
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root',
  factory: () => '/api',
});

// Normalized HTTP failure. The backend's error contract is `{ error: string }`
// (plus `details` on validation); the error interceptor maps that onto this shape
// so callers (stores) never touch HttpErrorResponse directly.
export interface AppError {
  status: number;
  message: string;
}
