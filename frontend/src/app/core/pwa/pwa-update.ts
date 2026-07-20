import { ApplicationRef, inject, Service, signal } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { concat, fromEvent, interval } from 'rxjs';
import { filter, first, map } from 'rxjs/operators';

// How often to poll the server for a newer app version once the app is stable.
const UPDATE_POLL_MS = 30 * 60 * 1000; // 30 minutes

// Watches the service worker for a newly deployed version. When one is downloaded
// and ready, `ready` flips true — the root component then shows a blocking overlay
// so the user MUST reload onto the new version (the old one can't keep being used).
//
// Nothing runs unless the service worker is enabled (production builds only), so in
// dev / `ng serve` this service is inert.
@Service()
export class PwaUpdate {
  private readonly swUpdate = inject(SwUpdate);
  private readonly appRef = inject(ApplicationRef);

  private readonly _ready = signal(false);
  /** A new version has been fetched and is ready to activate. */
  readonly ready = this._ready.asReadonly();

  constructor() {
    if (!this.swUpdate.isEnabled) return;

    // Fires once the new version's assets are fully downloaded — safe to activate.
    this.swUpdate.versionUpdates
      .pipe(filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'))
      .subscribe(() => this._ready.set(true));

    // Poll for updates, but only after the app first stabilises (Angular's guidance —
    // checking before that can race with the initial load). Also re-check whenever the
    // PWA is brought back to the foreground, so reopening picks up a fresh deploy fast.
    const stable$ = this.appRef.isStable.pipe(first((stable) => stable));
    const onResume$ = fromEvent(document, 'visibilitychange').pipe(
      filter(() => document.visibilityState === 'visible'),
    );
    concat(stable$, interval(UPDATE_POLL_MS)).subscribe(() => this.check());
    onResume$.pipe(map(() => undefined)).subscribe(() => this.check());
  }

  private async check(): Promise<void> {
    try {
      await this.swUpdate.checkForUpdate();
    } catch {
      // Offline or transient network error — ignore, we'll try again next tick.
    }
  }

  // Swap to the new version and hard-reload so every open tab/view runs it.
  async activate(): Promise<void> {
    try {
      await this.swUpdate.activateUpdate();
    } finally {
      document.location.reload();
    }
  }
}
