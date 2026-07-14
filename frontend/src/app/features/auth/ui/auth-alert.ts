import { Component, input } from '@angular/core';

import { Icon } from '../../../shared/ui/icon';

// Accent alert strip used for auth errors (invalid credentials, email taken, …).
@Component({
  selector: 'ct-auth-alert',
  imports: [Icon],
  host: { role: 'alert' },
  template: `
    <ct-icon name="alert" />
    <span>{{ message() }}</span>
  `,
  styles: `
    :host {
      display: flex;
      gap: var(--space-2);
      align-items: flex-start;
      background: var(--color-accent-100);
      border-left: 3px solid var(--color-accent);
      padding: var(--space-3);
      margin-bottom: var(--space-4);
      font-size: 13px;
      color: var(--color-accent-800);
    }
  `,
})
export class AuthAlert {
  readonly message = input.required<string>();
}
