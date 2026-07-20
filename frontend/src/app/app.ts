import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { I18n } from './core/i18n/i18n';
import { PwaUpdate } from './core/pwa/pwa-update';

// Root component: the app is a mobile-sized single column. Everything else
// (shell, tabs, sheets) is rendered through the router. A full-screen overlay
// sits above all of it when a new app version is ready, forcing a reload so the
// stale version can't keep being used.
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: `
    <router-outlet />

    @if (pwa.ready()) {
      <div class="update-scrim" role="alertdialog" aria-modal="true" aria-labelledby="update-title">
        <div class="update-card">
          <h4 id="update-title">{{ i18n.t('update.title') }}</h4>
          <p class="text-muted">{{ i18n.t('update.message') }}</p>
          <button class="btn btn-primary update-btn" type="button" (click)="pwa.activate()">
            {{ i18n.t('update.action') }}
          </button>
        </div>
      </div>
    }
  `,
  styles: `
    .update-scrim {
      position: fixed;
      inset: 0;
      z-index: 200;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--space-6);
      padding-top: max(var(--space-6), env(safe-area-inset-top));
      padding-bottom: max(var(--space-6), env(safe-area-inset-bottom));
      background: color-mix(in srgb, var(--color-neutral-900) 55%, transparent);
      animation: ct-fade 0.15s ease;
    }
    .update-card {
      width: 100%;
      max-width: 340px;
      background: var(--color-surface);
      border-top: 2px solid var(--color-accent);
      border-radius: var(--radius-lg);
      padding: var(--space-6);
      text-align: center;
      box-shadow: var(--shadow-lg);
    }
    .update-card p { margin-bottom: var(--space-4); }
    .update-btn { width: 100%; justify-content: center; }
  `,
  styleUrl: './app.scss',
})
export class App {
  protected readonly i18n = inject(I18n);
  protected readonly pwa = inject(PwaUpdate);
}
