import { inject } from '@angular/core';
import { HttpInterceptorFn } from '@angular/common/http';

import { API_BASE_URL } from './api.config';
import { AuthStore } from '../auth/auth.store';

// Attaches the access token to our API calls and enables credentials so the
// httpOnly refresh cookie (path-scoped to /api/auth) is sent and stored.
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const apiBase = inject(API_BASE_URL);
  if (!req.url.startsWith(apiBase)) {
    return next(req);
  }

  const token = inject(AuthStore).accessToken();
  const authorized = req.clone({
    withCredentials: true,
    setHeaders: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return next(authorized);
};
