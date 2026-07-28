// Prepares a camera/gallery photo for upload: decode → downscale → re-encode as JPEG.
//
// Three things happen as a side effect of the canvas round-trip, and all three are
// deliberate:
//   - EXIF is stripped, including GPS coordinates. A meal photo is plausibly Article 9
//     health data under GDPR; its location has no business leaving the device.
//   - EXIF orientation is baked in, so an iPhone portrait shot isn't analysed sideways.
//   - HEIC becomes JPEG, which the vision provider accepts and HEIC is not.

/**
 * Longest edge of the uploaded image.
 *
 * Resist lowering this to save tokens. The saving is fractions of a cent per photo,
 * while portion and texture cues are the model's main accuracy input — and portion size
 * is already the dominant error source in this task. Shrinking here degrades the one
 * thing the model is here to do.
 */
const MAX_EDGE = 1024;

const JPEG_QUALITY = 0.85;

/** Decoded, downscaled, EXIF-free JPEG ready to POST. */
export async function preparePhoto(file: File): Promise<Blob> {
  const bitmap = await decode(file);
  try {
    return await toJpeg(bitmap);
  } finally {
    bitmap.close();
  }
}

/**
 * Decode to a bitmap with EXIF orientation applied.
 *
 * Safari decodes HEIC natively through the system codec, and iOS usually transcodes to
 * JPEG at the file-picker boundary anyway — so the common path needs no library at all.
 * heic2any (~1.5 MB) is imported only when the native decode actually fails, mirroring
 * how `barcode-scanner.ts` defers the zxing WASM reader.
 */
async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    const { default: heic2any } = await import('heic2any');
    const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: JPEG_QUALITY });
    // heic2any returns Blob[] for multi-image HEICs (e.g. burst shots); the first frame
    // is the one the user saw in their camera roll.
    const blob = Array.isArray(converted) ? converted[0] : converted;
    if (!blob) throw new Error('Image could not be decoded');
    return createImageBitmap(blob, { imageOrientation: 'from-image' });
  }
}

function toJpeg(bitmap: ImageBitmap): Promise<Blob> {
  // Only ever downscale — upscaling a small photo adds bytes and no detail.
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(bitmap, 0, 0, width, height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Image could not be encoded'))),
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
}
