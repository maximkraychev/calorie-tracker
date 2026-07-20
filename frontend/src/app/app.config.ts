import {
  ApplicationConfig,
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';

import { routes } from './app.routes';
import { authInterceptor } from './core/api/auth.interceptor';
import { errorInterceptor } from './core/api/error.interceptor';
import { AuthStore } from './core/auth/auth.store';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([authInterceptor, errorInterceptor])),
    // Trade the refresh cookie for a session before the first route resolves, so
    // guards see a settled auth status instead of bouncing a logged-in user.
    provideAppInitializer(() => inject(AuthStore).restoreSession()),
    // PWA service worker. Only active in production builds (isDevMode() is false),
    // so `ng serve` stays uncached. registerWhenStable defers registration until
    // the app is idle, then falls back after 30s so it always registers eventually.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
