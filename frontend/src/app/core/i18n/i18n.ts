import { computed, Service, signal } from '@angular/core';

import { dictionaries, type Language, type TranslationKey } from './translations';

const STORAGE_KEY = 'ct.lang';
const SUPPORTED: Language[] = ['en', 'bg'];

// Runtime translation store. Language is a signal, so anything that reads it —
// including `t()` below — re-renders automatically when the user switches. This
// is a runtime toggle (both dictionaries ship in one bundle), not `@angular/localize`.
@Service()
export class I18n {
  private readonly _lang = signal<Language>(this.initialLanguage());

  readonly lang = this._lang.asReadonly();
  readonly languages = SUPPORTED;

  /** The locale used for `Intl`-based formatting (dates, numbers). */
  readonly locale = computed(() => (this._lang() === 'bg' ? 'bg-BG' : 'en-US'));

  /**
   * Translate a key for the current language. Reads the `lang` signal, so calling
   * it in a template (`{{ i18n.t('nav.diary') }}`) is reactive to language changes.
   */
  t(key: TranslationKey): string {
    return dictionaries[this._lang()][key];
  }

  setLanguage(lang: Language): void {
    this._lang.set(lang);
    document.documentElement.lang = lang;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // localStorage can be unavailable (private mode); language just won't persist.
    }
  }

  private initialLanguage(): Language {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      stored = null;
    }
    const lang = SUPPORTED.includes(stored as Language) ? (stored as Language) : 'en';
    document.documentElement.lang = lang;
    return lang;
  }
}
