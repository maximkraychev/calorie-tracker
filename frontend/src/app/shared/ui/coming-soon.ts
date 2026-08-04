import { Component, inject, input } from '@angular/core';

import { I18n } from '../../core/i18n/i18n';
import type { TranslationKey } from '../../core/i18n/translations';

// Placeholder for tabs not yet built. Nothing routes to it today — it is kept for the
// next feature that needs a stub. `titleKey` is bound from the route's `data` via
// withComponentInputBinding.
@Component({
  selector: 'ct-coming-soon',
  template: `
    <div class="page">
      <h2>{{ i18n.t(titleKey()) }}</h2>
      <p class="text-muted">{{ i18n.t('common.comingSoon') }}</p>
    </div>
  `,
  styles: `
    .page { padding: var(--space-4) var(--space-4) 90px; }
    h2 { font-size: 28px; margin-bottom: var(--space-3); }
  `,
})
export class ComingSoon {
  protected readonly i18n = inject(I18n);
  readonly titleKey = input.required<TranslationKey>();
}
