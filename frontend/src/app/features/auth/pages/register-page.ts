import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { email, Field, form, FormField, minLength, required } from '@angular/forms/signals';

import type { AppError } from '../../../core/api/api.config';
import { AuthStore } from '../../../core/auth/auth.store';
import { I18n } from '../../../core/i18n/i18n';
import { AuthAlert } from '../ui/auth-alert';
import { AuthCard } from '../ui/auth-card';

@Component({
  selector: 'ct-register-page',
  imports: [FormField, RouterLink, AuthCard, AuthAlert],
  template: `
    <ct-auth-card>
      <h1>{{ i18n.t('auth.register.title') }}</h1>

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
            [formField]="registerForm.email"
          />
          @if (showError(registerForm.email)) {
            <p class="field-error">{{ firstError(registerForm.email) }}</p>
          }
        </div>

        <div class="field password-field">
          <label for="password">{{ i18n.t('auth.password') }}</label>
          <input
            id="password"
            class="input"
            type="password"
            autocomplete="new-password"
            [formField]="registerForm.password"
          />
          @if (showError(registerForm.password)) {
            <p class="field-error">{{ firstError(registerForm.password) }}</p>
          }
        </div>

        <p class="text-muted hint">{{ i18n.t('auth.register.passwordHint') }}</p>

        <button class="btn btn-primary submit" type="submit" [disabled]="loading()">
          {{ i18n.t('auth.register.submit') }}
        </button>
      </form>

      <p class="switch text-muted">
        {{ i18n.t('auth.register.haveAccount') }}
        <a routerLink="/login">{{ i18n.t('auth.register.signIn') }}</a>
      </p>
    </ct-auth-card>
  `,
  styles: `
    h1 { font-size: 34px; margin-bottom: var(--space-6); }
    .field { margin-bottom: var(--space-4); }
    .password-field { margin-bottom: var(--space-2); }
    .hint { font-size: 12px; margin-bottom: var(--space-6); }
    .submit { width: 100%; justify-content: center; padding: var(--space-3); }
    .switch { text-align: center; margin-top: var(--space-4); font-size: 14px; }
    .switch a { font-weight: 600; }
  `,
})
export class RegisterPage {
  protected readonly i18n = inject(I18n);
  private readonly auth = inject(AuthStore);

  protected readonly loading = signal(false);
  protected readonly serverError = signal<string | null>(null);
  private readonly submitted = signal(false);

  private readonly registerModel = signal({ email: '', password: '' });
  protected readonly registerForm = form(this.registerModel, (path) => {
    required(path.email, { message: this.i18n.t('error.emailRequired') });
    email(path.email, { message: this.i18n.t('error.emailInvalid') });
    required(path.password, { message: this.i18n.t('error.passwordRequired') });
    minLength(path.password, 8, { message: this.i18n.t('error.passwordMin') });
  });

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    this.submitted.set(true);
    this.serverError.set(null);
    if (this.registerForm().invalid()) {
      return;
    }

    this.loading.set(true);
    try {
      await this.auth.register(this.registerModel());
    } catch (err) {
      this.serverError.set(this.messageFor(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected showError(field: Field<string>): boolean {
    const state = field();
    return (this.submitted() || state.touched()) && state.invalid();
  }

  protected firstError(field: Field<string>): string {
    return field().errors()[0]?.message ?? '';
  }

  private messageFor(err: unknown): string {
    const status = (err as AppError)?.status;
    if (status === 409) return this.i18n.t('error.emailTaken');
    if (status === 0) return this.i18n.t('error.network');
    return this.i18n.t('error.generic');
  }
}
