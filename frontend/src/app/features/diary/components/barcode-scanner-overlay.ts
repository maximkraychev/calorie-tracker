import {
  afterNextRender,
  Component,
  DestroyRef,
  inject,
  output,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { I18n } from '../../../core/i18n/i18n';
import { Icon } from '../../../shared/ui/icon';
import { BarcodeLookupApi } from '../data/barcode-lookup.api';
import { BarcodeScanner } from '../data/barcode-scanner';
import type { FoodSearchResult } from '../models/food-search.models';

// The scanner's lifecycle as one state machine: request camera → live scan → (on a code)
// look it up in Open Food Facts → hand a ready result up, or report "not found" with a
// one-tap "scan again". Camera/permission failures each get their own message so the user
// knows whether to grant access, plug in a camera, or just retry.
type ScanState =
  | { status: 'starting' }
  | { status: 'scanning' }
  | { status: 'looking' }
  | { status: 'notFound'; code: string }
  | { status: 'denied' }
  | { status: 'noCamera' }
  | { status: 'unavailable' }
  | { status: 'error' };

// Full-screen barcode scanner (z 60, above the Add-Food overlay). Self-contained: it owns
// the camera stream and the OFF barcode lookup, emitting `found` with a result already
// normalized to the app's per-100g shape — the parent just drops it into the portion step,
// exactly like a search pick. Decoding runs on zxing-wasm (see BarcodeScanner); the WASM
// chunk loads on first open only.
@Component({
  selector: 'ct-barcode-scanner-overlay',
  imports: [Icon],
  template: `
    <div class="overlay" role="dialog" [attr.aria-label]="i18n.t('scan.title')">
      <header class="head">
        <div class="title">{{ i18n.t('scan.title') }}</div>
        <button
          class="btn btn-icon"
          type="button"
          [attr.aria-label]="i18n.t('account.close')"
          (click)="close.emit()"
        >
          <ct-icon name="x" />
        </button>
      </header>

      <div class="stage">
        <!-- The camera preview is always mounted (we need the element to attach the stream
             to); overlays sit on top of it per state. -->
        <video #video class="video" playsinline autoplay muted></video>

        @switch (state().status) {
          @case ('scanning') {
            <div class="reticle" aria-hidden="true"></div>
            <p class="hint" role="status">{{ i18n.t('scan.aim') }}</p>
          }
          @case ('starting') {
            <div class="panel">
              <div class="spinner" role="status" [attr.aria-label]="i18n.t('scan.starting')"></div>
              <p class="msg">{{ i18n.t('scan.starting') }}</p>
            </div>
          }
          @case ('looking') {
            <div class="panel">
              <div class="spinner" role="status" [attr.aria-label]="i18n.t('scan.looking')"></div>
              <p class="msg">{{ i18n.t('scan.looking') }}</p>
            </div>
          }
          @case ('notFound') {
            <div class="panel">
              <ct-icon name="alert" [size]="40" />
              <p class="msg">{{ i18n.t('scan.notFound') }}</p>
              <p class="code">{{ asNotFound(state()).code }}</p>
              <button class="btn btn-primary wide" type="button" (click)="restart()">
                <ct-icon name="scan" [size]="18" />
                {{ i18n.t('scan.again') }}
              </button>
            </div>
          }
          @case ('denied') {
            <div class="panel">
              <ct-icon name="alert" [size]="40" />
              <p class="msg">{{ i18n.t('scan.denied') }}</p>
            </div>
          }
          @case ('noCamera') {
            <div class="panel">
              <ct-icon name="alert" [size]="40" />
              <p class="msg">{{ i18n.t('scan.noCamera') }}</p>
            </div>
          }
          @case ('unavailable') {
            <div class="panel">
              <ct-icon name="alert" [size]="40" />
              <p class="msg">{{ i18n.t('scan.unavailable') }}</p>
            </div>
          }
          @case ('error') {
            <div class="panel">
              <ct-icon name="alert" [size]="40" />
              <p class="msg">{{ i18n.t('scan.error') }}</p>
              <button class="btn btn-primary wide" type="button" (click)="restart()">
                {{ i18n.t('scan.again') }}
              </button>
            </div>
          }
        }
      </div>
    </div>
  `,
  styles: `
    .overlay {
      position: absolute;
      inset: 0;
      z-index: 60;
      background: #000;
      display: flex;
      flex-direction: column;
      animation: ct-sheet 0.24s ease;
    }
    .head {
      flex: none;
      display: flex;
      align-items: center;
      gap: var(--space-2);
      padding: 0 var(--space-3);
      height: 52px;
      color: #fff;
    }
    .head .btn-icon { border: 1px solid rgba(255, 255, 255, 0.3); color: #fff; }
    .title {
      font-family: var(--font-heading);
      font-weight: 800;
      font-size: 16px;
      margin-right: auto;
    }

    .stage {
      position: relative;
      flex: 1;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .video {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      background: #000;
    }

    /* Scanning guide — a framed window centered over the feed. */
    .reticle {
      position: relative;
      width: min(78%, 320px);
      height: 40%;
      max-height: 220px;
      border: 3px solid rgba(255, 255, 255, 0.9);
      border-radius: 16px;
      box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.45);
    }
    .hint {
      position: absolute;
      bottom: var(--space-6);
      left: 0;
      right: 0;
      text-align: center;
      color: #fff;
      font-size: 14px;
      padding: 0 var(--space-4);
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
    }

    /* Non-scanning states (loading / errors) get an opaque card over the feed. */
    .panel {
      position: relative;
      z-index: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-3);
      text-align: center;
      color: var(--color-text);
      background: var(--color-bg);
      border: 1px solid var(--color-divider);
      border-radius: 18px;
      padding: var(--space-6) var(--space-5);
      margin: var(--space-4);
      max-width: 320px;
    }
    .msg { font-size: 15px; }
    .code {
      font-family: var(--font-heading);
      font-weight: 800;
      font-size: 18px;
      letter-spacing: 0.04em;
    }
    .wide { width: 100%; justify-content: center; padding: var(--space-3); }

    .spinner {
      width: 44px;
      height: 44px;
      border: 3px solid var(--color-divider);
      border-top-color: var(--color-accent);
      border-radius: 50%;
      animation: ct-scan-spin 0.8s linear infinite;
    }
    @keyframes ct-scan-spin { to { transform: rotate(360deg); } }
  `,
})
export class BarcodeScannerOverlay {
  protected readonly i18n = inject(I18n);
  private readonly scanner = inject(BarcodeScanner);
  private readonly lookupApi = inject(BarcodeLookupApi);
  private readonly destroyRef = inject(DestroyRef);

  /** A product resolved from a scanned barcode, ready for the portion step. */
  readonly found = output<FoodSearchResult>();
  readonly close = output<void>();

  private readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');

  protected readonly state = signal<ScanState>({ status: 'starting' });

  // The active camera stream and the loop's cancel handle — torn down on stop/destroy.
  private stream: MediaStream | null = null;
  private abort: AbortController | null = null;

  constructor() {
    afterNextRender(() => this.begin());
    this.destroyRef.onDestroy(() => this.stopCamera());
  }

  // Narrowing helper for the template — `@switch` can't refine the union on its own.
  protected asNotFound(state: ScanState): { code: string } {
    return state.status === 'notFound' ? state : { code: '' };
  }

  protected restart(): void {
    this.begin();
  }

  private async begin(): Promise<void> {
    this.state.set({ status: 'starting' });

    // Camera needs a secure context (HTTPS / localhost) and the mediaDevices API.
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      this.state.set({ status: 'unavailable' });
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // Rear camera when there is one; a high-res frame so the decoder can resolve the
        // thin bars of a barcode (the default ~640×480 blurs them, especially on webcams).
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
    } catch (error) {
      this.state.set({ status: cameraErrorState(error) });
      return;
    }

    this.stream = stream;
    const video = this.video().nativeElement;
    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      // Autoplay can be rejected if the element isn't visible yet; the stream is still
      // attached, so decoding can proceed once frames arrive.
    }

    this.state.set({ status: 'scanning' });
    this.runScan(video);
  }

  private async runScan(video: HTMLVideoElement): Promise<void> {
    this.abort = new AbortController();
    try {
      const code = await this.scanner.scan(video, this.abort.signal);
      this.stopCamera();
      this.lookup(code);
    } catch (error) {
      // Aborting (user cancelled / restarted) is expected; anything else is a real fault.
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        this.stopCamera();
        this.state.set({ status: 'error' });
      }
    }
  }

  private lookup(code: string): void {
    this.state.set({ status: 'looking' });
    this.lookupApi
      .lookup(code, this.i18n.lang())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) =>
          result ? this.found.emit(result) : this.state.set({ status: 'notFound', code }),
        error: () => this.state.set({ status: 'error' }),
      });
  }

  // Cancel the decode loop and release the camera. Idempotent — safe to call on stop and
  // again on destroy.
  private stopCamera(): void {
    this.abort?.abort();
    this.abort = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}

// Map a getUserMedia rejection to the matching state. NotAllowedError = permission denied;
// NotFoundError = no camera on the device; everything else is a generic failure.
function cameraErrorState(error: unknown): 'denied' | 'noCamera' | 'error' {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'denied';
    if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') return 'noCamera';
  }
  return 'error';
}
