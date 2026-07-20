import { Component, inject } from '@angular/core';

import { I18n } from '../../../core/i18n/i18n';
import type { Language } from '../../../core/i18n/translations';

// Full-screen frame shared by the auth pages: brand wordmark + language toggle at the
// top, then the page's own heading + form projected in. The language switch lives here
// (not in a menu) so it's reachable before the user has signed in. Left-aligned, plain,
// fast (per the spec).
@Component({
  selector: 'ct-auth-card',
  template: `
    <div class="wrap">
      <div class="head">
        <div class="brand">{{ i18n.t('app.name') }}</div>
        <div class="lang-toggle" role="group" [attr.aria-label]="i18n.t('account.language')">
          @for (lang of i18n.languages; track lang) {
            <button
              type="button"
              class="lang-option"
              [class.active]="i18n.lang() === lang"
              [attr.aria-pressed]="i18n.lang() === lang"
              (click)="setLanguage(lang)"
            >
              {{ lang === 'bg' ? 'БГ' : 'EN' }}
            </button>
          }
        </div>
      </div>
      <ng-content />
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100dvh;
      background: var(--color-bg);
      animation: ct-fade 0.2s ease;
    }
    .wrap {
      display: flex;
      flex-direction: column;
      max-width: 480px;
      min-height: 100dvh;
      margin: 0 auto;
      /* Base padding, but never less than the device safe-area insets (notch/home bar). */
      padding: max(var(--space-8), env(safe-area-inset-top)) max(var(--space-6), env(safe-area-inset-right))
        max(var(--space-8), env(safe-area-inset-bottom)) max(var(--space-6), env(safe-area-inset-left));
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-4);
      margin-bottom: var(--space-8);
    }
    .brand {
      font-family: var(--font-heading);
      font-weight: 800;
      font-size: 15px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .lang-toggle {
      flex: none;
      display: flex;
      gap: 1px;
      background: var(--color-divider);
      border: 1px solid var(--color-divider);
    }
    .lang-option {
      padding: 6px 12px;
      border: 0;
      cursor: pointer;
      font-family: var(--font-heading);
      font-weight: 800;
      font-size: 12px;
      background: var(--color-bg);
      color: var(--color-text);
    }
    .lang-option.active { background: var(--color-accent); color: var(--color-bg); }
  `,
})
export class AuthCard {
  protected readonly i18n = inject(I18n);

  protected setLanguage(lang: Language): void {
    this.i18n.setLanguage(lang);
  }
}
