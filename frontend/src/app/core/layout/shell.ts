import { Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { AuthStore } from '../auth/auth.store';
import { I18n } from '../i18n/i18n';
import type { Language } from '../i18n/translations';
import { Icon } from '../../shared/ui/icon';

// Authenticated app frame: fixed top bar + scrolling feature content + bottom tabs,
// laid out as a phone-sized column. The account sheet (with the language toggle and
// sign-out) slides up over a scrim.
@Component({
  selector: 'ct-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon],
  template: `
    <div class="shell">
      <header class="topbar">
        <div class="brand">{{ i18n.t('app.name') }}</div>
        <button
          class="btn btn-icon"
          type="button"
          [attr.aria-label]="i18n.t('account.title')"
          (click)="accountOpen.set(true)"
        >
          <ct-icon name="user" />
        </button>
      </header>

      <main class="content">
        <router-outlet />
      </main>

      <nav class="tabbar" [attr.aria-label]="i18n.t('app.name')">
        <a routerLink="/diary" routerLinkActive="active" class="tab">
          <ct-icon name="utensils" />
          <span>{{ i18n.t('nav.diary') }}</span>
        </a>
        <a routerLink="/foods" routerLinkActive="active" class="tab">
          <ct-icon name="apple" />
          <span>{{ i18n.t('nav.myFoods') }}</span>
        </a>
        <a routerLink="/recipes" routerLinkActive="active" class="tab">
          <ct-icon name="book" />
          <span>{{ i18n.t('nav.recipes') }}</span>
        </a>
      </nav>

      @if (accountOpen()) {
        <div class="scrim" (click)="accountOpen.set(false)">
          <div class="sheet" (click)="$event.stopPropagation()">
            <div class="account-head">
              <div class="avatar"><ct-icon name="user" /></div>
              <div>
                <div class="account-email">{{ auth.user()?.email }}</div>
                <div class="text-muted account-status">{{ i18n.t('account.signedIn') }}</div>
              </div>
            </div>

            <div class="lang-label text-muted">{{ i18n.t('account.language') }}</div>
            <div class="lang-toggle">
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

            <button class="btn btn-secondary sheet-btn" type="button" (click)="accountOpen.set(false)">
              {{ i18n.t('account.close') }}
            </button>
            <button class="btn btn-primary sheet-btn" type="button" (click)="signOut()">
              {{ i18n.t('account.signOut') }}
            </button>
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    .shell {
      position: relative;
      display: flex;
      flex-direction: column;
      height: 100dvh;
      max-width: 480px;
      margin: 0 auto;
      overflow: hidden;
      background: var(--color-bg);
    }
    .topbar {
      flex: none;
      display: flex;
      align-items: center;
      gap: var(--space-3);
      height: 52px;
      padding: 0 var(--space-4);
      border-bottom: 2px solid var(--color-divider);
    }
    .topbar .btn-icon { border: 1px solid var(--color-divider); }
    .brand {
      margin-right: auto;
      font-family: var(--font-heading);
      font-weight: 800;
      font-size: 17px;
      letter-spacing: -0.02em;
      text-transform: uppercase;
    }
    .content { flex: 1; overflow-y: auto; }
    .tabbar {
      flex: none;
      display: flex;
      border-top: 2px solid var(--color-divider);
      background: var(--color-bg);
    }
    .tab {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;
      padding: 10px 0 12px;
      text-decoration: none;
      font-family: var(--font-heading);
      font-weight: 800;
      font-size: 11px;
      letter-spacing: 0.04em;
      color: color-mix(in srgb, var(--color-text) 55%, transparent);
    }
    .tab.active { color: var(--color-accent); }

    .scrim {
      position: absolute;
      inset: 0;
      z-index: 60;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      background: color-mix(in srgb, var(--color-neutral-900) 45%, transparent);
    }
    .sheet {
      background: var(--color-surface);
      padding: var(--space-4);
      border-top: 2px solid var(--color-accent);
      animation: ct-sheet 0.22s ease;
    }
    .account-head {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding-bottom: var(--space-3);
      margin-bottom: var(--space-3);
      border-bottom: 2px solid var(--color-divider);
    }
    .avatar {
      width: 44px;
      height: 44px;
      display: grid;
      place-items: center;
      background: var(--color-text);
      color: var(--color-bg);
    }
    .account-email { font-weight: 600; }
    .account-status { font-size: 12px; }
    .lang-label { font-size: 12px; margin-bottom: 6px; }
    .lang-toggle {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1px;
      margin-bottom: var(--space-4);
      background: var(--color-divider);
      border: 1px solid var(--color-divider);
    }
    .lang-option {
      padding: 10px 4px;
      border: 0;
      cursor: pointer;
      font-family: var(--font-heading);
      font-weight: 800;
      font-size: 13px;
      background: var(--color-bg);
      color: var(--color-text);
    }
    .lang-option.active { background: var(--color-accent); color: var(--color-bg); }
    .sheet-btn { width: 100%; justify-content: center; }
    .sheet-btn + .sheet-btn { margin-top: var(--space-2); }
  `,
})
export class Shell {
  protected readonly i18n = inject(I18n);
  protected readonly auth = inject(AuthStore);

  protected readonly accountOpen = signal(false);

  protected setLanguage(lang: Language): void {
    this.i18n.setLanguage(lang);
  }

  protected signOut(): void {
    this.accountOpen.set(false);
    void this.auth.logout();
  }
}
