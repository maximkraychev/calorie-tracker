import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { email, form, FormField, required } from '@angular/forms/signals';

import { I18n } from '../../../core/i18n/i18n';
import { Icon } from '../../../shared/ui/icon';
import { AuthCard } from '../ui/auth-card';

// Password reset is a non-functional stub in this build: it always shows the same
// neutral confirmation, so it never reveals whether an email has an account.
@Component({
  selector: 'ct-forgot-page',
  imports: [FormField, RouterLink, AuthCard, Icon],
  template: `
    <ct-auth-card>
      <a routerLink="/login" class="btn btn-ghost back">
        <ct-icon name="arrow-left" />
        {{ i18n.t('auth.forgot.back') }}
      </a>

      <h1>{{ i18n.t('auth.forgot.title') }}</h1>
      <p class="text-muted intro">{{ i18n.t('auth.forgot.intro') }}</p>

      <form (submit)="submit($event)" novalidate>
        <div class="field">
          <label for="email">{{ i18n.t('auth.email') }}</label>
          <input
            id="email"
            class="input"
            type="email"
            autocomplete="email"
            [placeholder]="i18n.t('auth.emailPlaceholder')"
            [formField]="forgotForm.email"
          />
        </div>

        @if (sent()) {
          <div class="confirm" role="status">
            <ct-icon name="check" />
            <span>{{ i18n.t('auth.forgot.sent') }}</span>
          </div>
        }

        <button class="btn btn-primary submit" type="submit" [disabled]="forgotForm().invalid()">
          {{ i18n.t('auth.forgot.submit') }}
        </button>
      </form>
    </ct-auth-card>
  `,
  styles: `
    .back { padding: 0; margin-bottom: var(--space-4); }
    h1 { font-size: 34px; margin-bottom: var(--space-3); }
    .intro { margin-bottom: var(--space-6); font-size: 14px; }
    .field { margin-bottom: var(--space-6); }
    .submit { width: 100%; justify-content: center; padding: var(--space-3); }
    .confirm {
      display: flex;
      gap: var(--space-2);
      align-items: center;
      background: var(--color-neutral-100);
      border-left: 3px solid var(--color-text);
      padding: var(--space-3);
      margin-bottom: var(--space-4);
      font-size: 13px;
    }
  `,
})
export class ForgotPage {
  protected readonly i18n = inject(I18n);
  protected readonly sent = signal(false);

  private readonly forgotModel = signal({ email: '' });
  protected readonly forgotForm = form(this.forgotModel, (path) => {
    required(path.email, { message: this.i18n.t('error.emailRequired') });
    email(path.email, { message: this.i18n.t('error.emailInvalid') });
  });

  protected submit(event: Event): void {
    event.preventDefault();
    if (this.forgotForm().invalid()) {
      return;
    }
    // Stub: no request is sent — just acknowledge.
    this.sent.set(true);
  }
}
