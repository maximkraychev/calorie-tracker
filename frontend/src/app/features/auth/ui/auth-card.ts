import { Component, inject } from '@angular/core';

import { I18n } from '../../../core/i18n/i18n';

// Full-screen frame shared by the auth pages: brand wordmark at the top, then the
// page's own heading + form projected in. Left-aligned, plain, fast (per the spec).
@Component({
  selector: 'ct-auth-card',
  template: `
    <div class="wrap">
      <div class="brand">{{ i18n.t('app.name') }}</div>
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
    .brand {
      font-family: var(--font-heading);
      font-weight: 800;
      font-size: 15px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      margin-bottom: var(--space-8);
    }
  `,
})
export class AuthCard {
  protected readonly i18n = inject(I18n);
}
