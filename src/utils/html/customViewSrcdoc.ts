// Build the sandboxed-iframe `srcdoc` for a custom collection view (see
// plans/feat-collections-custom-views.md). Pure (takes the server origin
// explicitly instead of reading `window`), so it's unit-testable and keeps
// the script-tag string out of the .vue SFC source.
//
// Injected at the START of <head> so the bootstrap runs before any of the
// view's own scripts:
//   1. a CSP <meta> with connect-src = the server origin (the view may fetch
//      its data endpoint but no third party), and
//   2. `window.__MC_VIEW = { slug, token, dataUrl }` — the scoped capability
//      token + the absolute data URL the view reads.

import { buildCustomViewCsp } from "./previewCsp";

export interface CustomViewBootstrap {
  slug: string;
  /** Scoped capability token (Authorization: Bearer <token>). */
  token: string;
  /** Data endpoint URL; absolutised against `origin` when root-relative
   *  (the iframe is `about:srcdoc`, so a relative `/api/...` would not
   *  resolve against the server origin). */
  dataUrl: string;
  /** Explicit server origin — used for both the CSP and the absolute
   *  dataUrl (the sandboxed iframe's own origin is opaque). */
  origin: string;
}

function absoluteDataUrl(dataUrl: string, origin: string): string {
  return dataUrl.startsWith("/") ? `${origin}${dataUrl}` : dataUrl;
}

export function buildCustomViewSrcdoc(html: string, boot: CustomViewBootstrap): string {
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${buildCustomViewCsp(boot.origin)}">`;
  // `<`-escape the JSON so a hostile token/slug value can't break out of the
  // <script> element.
  const json = JSON.stringify({
    slug: boot.slug,
    token: boot.token,
    dataUrl: absoluteDataUrl(boot.dataUrl, boot.origin),
  }).replace(/</g, "\\u003c");
  const injection = `${cspMeta}<script>window.__MC_VIEW=${json};</script>`;
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/(<head\b[^>]*>)/i, `$1${injection}`);
  }
  return `<!DOCTYPE html><html><head>${injection}</head><body>${html}</body></html>`;
}
