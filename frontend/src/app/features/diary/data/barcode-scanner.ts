import { Service } from '@angular/core';

import type { ReaderOptions, ReadResult } from 'zxing-wasm/reader';

// Client-side barcode decoding via zxing-wasm. We use the WASM decoder on every device
// rather than the native BarcodeDetector API: BarcodeDetector is unsupported in every
// iOS browser (all WebKit) and this is an iPhone-first PWA, so one code path everywhere
// is simpler and behaves identically. The reader (~38 KB JS glue + ~1 MB WASM) loads the
// first time a scan starts — dynamically imported and served same-origin — so it never
// touches the initial bundle or the search/manual paths.
//
// The WASM binary is served same-origin (copied to /zxing_reader.wasm by angular.json and
// precached by the service worker) instead of zxing-wasm's default jsDelivr CDN, which a
// strict CSP would block and which wouldn't work offline.

// EAN/UPC are the retail symbologies printed on packaged food; restricting the format set
// makes each decode faster and avoids stray matches on QR codes etc.
const FORMATS: ReaderOptions['formats'] = ['EAN-13', 'EAN-8', 'UPC-A', 'UPC-E'];

// How often we grab a frame off the video and try to decode it. zxing-wasm decodes a
// frame in well under this budget on modern phones; a small gap keeps the main thread
// responsive and the preview smooth.
const SCAN_INTERVAL_MS = 250;

@Service()
export class BarcodeScanner {
  // The lazily-imported reader module (import + first WASM instantiation), cached so a
  // second scan in the same session is instant.
  private reader?: Promise<typeof import('zxing-wasm/reader')>;

  /**
   * Continuously grab frames from a playing `<video>` and decode them, resolving with the
   * first barcode's digits. Runs until a code is found or `signal` aborts (user cancels /
   * overlay closes), in which case it rejects with an `AbortError`. The caller owns the
   * camera stream; this only reads pixels from the element.
   */
  async scan(video: HTMLVideoElement, signal: AbortSignal): Promise<string> {
    const { readBarcodes } = await this.loadReader();
    // Reused across frames — allocating one canvas beats one per attempt.
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D context unavailable');

    while (!signal.aborted) {
      const code = await this.decodeFrame(video, canvas, ctx, readBarcodes);
      if (code) return code;
      await delay(SCAN_INTERVAL_MS, signal);
    }
    throw new DOMException('Scan aborted', 'AbortError');
  }

  // Snapshot the current video frame into the canvas and hand its pixels to zxing. Returns
  // the digits of the first valid barcode, or null when this frame held none.
  private async decodeFrame(
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    readBarcodes: typeof import('zxing-wasm/reader').readBarcodes,
  ): Promise<string | null> {
    const width = video.videoWidth;
    const height = video.videoHeight;
    // The camera may not have delivered a frame yet in the first tick or two.
    if (!width || !height) return null;

    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(video, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);

    const results = await readBarcodes(imageData, { formats: FORMATS, tryHarder: true });
    const hit = results.find((r: ReadResult) => r.isValid && r.text);
    return hit?.text ?? null;
  }

  private loadReader(): Promise<typeof import('zxing-wasm/reader')> {
    this.reader ??= import('zxing-wasm/reader').then((module) => {
      // Load the WASM from our own origin instead of the CDN default.
      module.prepareZXingModule({
        overrides: {
          locateFile: (path: string, prefix: string) =>
            path.endsWith('.wasm') ? '/zxing_reader.wasm' : prefix + path,
        },
      });
      return module;
    });
    return this.reader;
  }
}

// A cancellable pause between scan attempts — resolves after `ms`, or immediately once the
// scan is aborted, so cancelling never waits out the interval.
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
  });
}
