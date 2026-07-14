import { computed, inject, Service, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { AuthApi } from './auth.api';
import type { Credentials, User } from './auth.models';

// Session state, signals-first. The access token lives only in memory (the durable
// credential is the httpOnly refresh cookie); on a page reload `restoreSession()`
// trades that cookie for a fresh token. `status` starts 'unknown' until then, which
// lets the guard wait instead of bouncing an authenticated user to /login.
type SessionStatus = 'unknown' | 'authenticated' | 'anonymous';

@Service()
export class AuthStore {
  private readonly api = inject(AuthApi);
  private readonly router = inject(Router);

  private readonly _user = signal<User | null>(null);
  private readonly _accessToken = signal<string | null>(null);
  private readonly _status = signal<SessionStatus>('unknown');

  readonly user = this._user.asReadonly();
  readonly accessToken = this._accessToken.asReadonly();
  readonly status = this._status.asReadonly();
  readonly isAuthenticated = computed(() => this._status() === 'authenticated');

  async login(credentials: Credentials): Promise<void> {
    const { user, accessToken } = await firstValueFrom(this.api.login(credentials));
    this.setSession(user, accessToken);
    await this.router.navigateByUrl('/');
  }

  async register(credentials: Credentials): Promise<void> {
    const { user, accessToken } = await firstValueFrom(this.api.register(credentials));
    this.setSession(user, accessToken);
    await this.router.navigateByUrl('/');
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.api.logout());
    } finally {
      this.clearSession();
      await this.router.navigateByUrl('/login');
    }
  }

  // Runs once at startup (provideAppInitializer). Never throws — a missing/expired
  // refresh cookie just leaves the user anonymous.
  async restoreSession(): Promise<void> {
    try {
      const { accessToken } = await firstValueFrom(this.api.refresh());
      this._accessToken.set(accessToken);
      const { user } = await firstValueFrom(this.api.me());
      this.setSession(user, accessToken);
    } catch {
      this.clearSession();
    }
  }

  private setSession(user: User, accessToken: string): void {
    this._user.set(user);
    this._accessToken.set(accessToken);
    this._status.set('authenticated');
  }

  private clearSession(): void {
    this._user.set(null);
    this._accessToken.set(null);
    this._status.set('anonymous');
  }
}
