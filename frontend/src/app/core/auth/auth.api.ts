import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { Observable } from 'rxjs';

import { API_BASE_URL } from '../api/api.config';
import type { AuthResponse, Credentials, MeResponse, RefreshResponse } from './auth.models';

// Thin HttpClient wrapper over /api/auth. `withCredentials` is set globally by the
// auth interceptor, so the refresh cookie flows without repeating it here.
@Service()
export class AuthApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(API_BASE_URL)}/auth`;

  register(credentials: Credentials): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.base}/register`, credentials);
  }

  login(credentials: Credentials): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${this.base}/login`, credentials);
  }

  refresh(): Observable<RefreshResponse> {
    return this.http.post<RefreshResponse>(`${this.base}/refresh`, {});
  }

  logout(): Observable<void> {
    return this.http.post<void>(`${this.base}/logout`, {});
  }

  me(): Observable<MeResponse> {
    return this.http.get<MeResponse>(`${this.base}/me`);
  }
}
