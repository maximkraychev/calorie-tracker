import { InjectionToken } from '@angular/core';

import { environment } from '../../../environments/environment';

// Base URL every `*.api.ts` service builds on. In dev this is a relative `/api`
// proxied to the Express backend (see proxy.conf.json); in production builds
// fileReplacements swap in the deployed backend's absolute URL.
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root',
  factory: () => environment.apiBaseUrl,
});

// Normalized HTTP failure. The backend's error contract is `{ error: string }`
// (plus `details` on validation); the error interceptor maps that onto this shape
// so callers (stores) never touch HttpErrorResponse directly.
export interface AppError {
  status: number;
  message: string;
}
