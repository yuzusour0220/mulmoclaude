// Ambient declaration for the `heic-convert` npm package (used by
// `server/utils/files/image-jpeg-convert.ts` for HEIC / HEIF → JPEG
// decoding via WASM libheif). Upstream ships no `.d.ts` and no
// `@types/heic-convert` package exists, so a minimal type surface
// lives here — narrowed to what we actually call.

declare module "heic-convert" {
  interface HeicConvertOptions {
    /** Input HEIC / HEIF bytes. */
    buffer: ArrayBufferLike | ArrayBufferView;
    /** Output container. `"JPEG"` for lossy, `"PNG"` for lossless. */
    format: "JPEG" | "PNG";
    /** 0..1 quality for JPEG. Defaults to 0.92 upstream. Ignored for
     *  PNG. */
    quality?: number;
  }

  /** Decode a single HEIC / HEIF still image to the given output
   *  container. Resolves to the encoded bytes. */
  export default function convert(options: HeicConvertOptions): Promise<ArrayBuffer>;
}
