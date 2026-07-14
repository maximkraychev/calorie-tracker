import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { email, Field, form, FormField, minLength, required } from '@angular/forms/signals';

import type { AppError } from '../../../core/api/api.config';
import { AuthStore } from '../../../core/auth/auth.store';
import { I18n } from '../../../core/i18n/i18n';
import { AuthAlert } from '../ui/auth-alert';
import { AuthCard } from '../ui/auth-card';

@Component({
  selector: 'ct-login-page',
  imports: [FormField, RouterLink, AuthCard, AuthAlert],
  template: `
    <ct-auth-card>
      <h1>{{ i18n.t('auth.login.title') }}</h1>

      @if (serverError()) {
        <ct-auth-alert [message]="serverError()!" />
      }

      <form (submit)="submit($event)" novalidate>
        <div class="field">
          <label for="email">{{ i18n.t('auth.email') }}</label>
          <input
            id="email"
            class="input"
            type="email"
            autocomplete="email"
            [placeholder]="i18n.t('auth.emailPlaceholder')"
            [formField]="loginForm.email"
          />
          @if (showError(loginForm.email)) {
            <p class="field-error">{{ firstError(loginForm.email) }}</p>
          }
        </div>

        <div class="field password-field">
          <label for="password">{{ i18n.t('auth.password') }}</label>
          <input
            id="password"
            class="input"
            type="password"
            autocomplete="current-password"
            [formField]="loginForm.password"
          />
          @if (showError(loginForm.password)) {
            <p class="field-error">{{ firstError(loginForm.password) }}</p>
          }
        </div>

        <a routerLink="/forgot" class="btn btn-ghost forgot">{{ i18n.t('auth.login.forgot') }}</a>

        <button class="btn btn-primary submit" type="submit" [disabled]="loading()">
          {{ i18n.t('auth.login.submit') }}
        </button>
      </form>

      <p class="switch text-muted">
        {{ i18n.t('auth.login.noAccount') }}
        <a routerLink="/register">{{ i18n.t('auth.login.createOne') }}</a>
      </p>
    </ct-auth-card>
  `,
  styles: `
    h1 { font-size: 34px; margin-bottom: var(--space-6); }
    .field { margin-bottom: var(--space-4); }
    .password-field { margin-bottom: var(--space-2); }
    .forgot { padding: 0; margin-bottom: var(--space-6); }
    .submit { width: 100%; justify-content: center; padding: var(--space-3); }
    .switch { text-align: center; margin-top: var(--space-4); font-size: 14px; }
    .switch a { font-weight: 600; }
  `,
})
export class LoginPage {
  protected readonly i18n = inject(I18n);
  private readonly auth = inject(AuthStore);

  protected readonly loading = signal(false);
  protected readonly serverError = signal<string | null>(null);
  private readonly submitted = signal(false);

  private readonly loginModel = signal({ email: '', password: '' });
  protected readonly loginForm = form(this.loginModel, (path) => {
    required(path.email, { message: this.i18n.t('error.emailRequired') });
    email(path.email, { message: this.i18n.t('error.emailInvalid') });
    required(path.password, { message: this.i18n.t('error.passwordRequired') });
    minLength(path.password, 8, { message: this.i18n.t('error.passwordMin') });
  });

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    this.submitted.set(true);
    this.serverError.set(null);
    if (this.loginForm().invalid()) {
      return;
    }

    this.loading.set(true);
    try {
      await this.auth.login(this.loginModel());
    } catch (err) {
      this.serverError.set(this.messageFor(err));
    } finally {
      this.loading.set(false);
    }
  }

  // Show a field's error once the user has tried to submit or left the field.
  protected showError(field: Field<string>): boolean {
    const state = field();
    return (this.submitted() || state.touched()) && state.invalid();
  }

  protected firstError(field: Field<string>): string {
    return field().errors()[0]?.message ?? '';
  }

  private messageFor(err: unknown): string {
    const status = (err as AppError)?.status;
    if (status === 401) return this.i18n.t('error.invalidCredentials');
    if (status === 0) return this.i18n.t('error.network');
    return this.i18n.t('error.generic');
  }
}
