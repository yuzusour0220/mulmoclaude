// Upload-time conversion of image MIME types Claude's Messages API
// refuses (HEIC / HEIF / TIFF / BMP / AVIF) into JPEG, so the
// downstream `type: "image"` content block Claude expects a
// `media_type` from a fixed allowlist can be filled without a 400.
// See `server/api/routes/attachment.ts` for the wiring: original
// bytes stay on disk as `<id>.<ext>`; the JPEG lands as a
// `<id>.jpg` companion; the UI shows the original filename while
// the LLM sees the JPEG.
//
// The `sharp` binary is loaded via `await import(...)` so tests can
// inject their own converter and never touch the native binary.
// Pattern mirrors `thumbnail-store.ts`'s `ResizeToJpeg` DI seam.

/** Convert an image buffer to JPEG bytes. Injected so tests exercise
 *  the route wiring without the native `sharp` binary. */
export type ConvertToJpeg = (input: Buffer) => Promise<Buffer>;

// JPEG quality for upload-time conversion. Higher than the thumbnail
// path (72) because these are the bytes the LLM will read — we want
// receipts / documents to stay legible. 90 keeps a typical iPhone
// HEIC around 1-2 MB after conversion, still well inside Claude's
// per-image size ceiling.
const UPLOAD_JPEG_QUALITY = 90;

// Image MIME types that arrive from uploads / the browser's file
// picker but that Claude's Messages API refuses on the
// `image.source.media_type` field. Anything in this set gets rasterized
// to JPEG at upload time so the pipeline downstream can send it as a
// native image content block.
//
// Explicitly EXCLUDED (Claude accepts natively): image/jpeg,
// image/png, image/gif, image/webp.
// Explicitly OUT OF SCOPE (needs viewport picking): image/svg+xml.
export const CLAUDE_UNSUPPORTED_IMAGE_MIMES: ReadonlySet<string> = new Set([
  // iOS Photos default capture format — very common in real uploads.
  "image/heic",
  "image/heif",
  // Scanner / camera raw outputs.
  "image/tiff",
  "image/bmp",
  // Newer capture format shipping on Android / Samsung.
  "image/avif",
]);

/** Production default: dynamic-import `sharp`, `.rotate()` bakes in
 *  EXIF orientation (portrait phone photos), `.jpeg({ quality: 90 })`
 *  emits the final buffer. Throws whatever `sharp` throws — the
 *  caller decides whether to fall back or surface the error. */
export const sharpConvertToJpeg: ConvertToJpeg = async (input) => {
  const sharp = (await import("sharp")).default;
  return sharp(input).rotate().jpeg({ quality: UPLOAD_JPEG_QUALITY }).toBuffer();
};
