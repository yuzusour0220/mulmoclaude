// A marked block-level extension that intercepts ```mermaid fences
// before the code/highlight pipeline sees them and rewrites the block
// into a `<pre class="mermaid" data-mermaid-pending="1">` placeholder.
//
// The actual diagram render is deferred to `mermaidRender.ts`, which
// scans the placeholders in the DOM after Vue's v-html injects the
// html. That two-step split keeps this extension pure (no runtime
// deps beyond `marked`) so tests can assert the html shape without
// booting a browser.
//
// Registration order matters: this must land BEFORE
// `markedHighlightExtension` in `setup.ts` so highlight.js never sees
// the mermaid fence — otherwise `mermaid` becomes a "plaintext"
// fallback highlight and the source text ends up escaped.

import type { MarkedExtension, TokenizerAndRendererExtension } from "marked";

const MERMAID_FENCE = /^```mermaid[ \t]*\n([\s\S]*?)\n```(?:\n|$)/;

// DOMPurify's default policy already permits <pre> + class + data-*,
// so the placeholder survives sanitisation on the viewers that call
// `sanitizeMarkdownHtml`. `data-mermaid-pending` doubles as the query
// selector `mermaidRender` uses AND as a guard so the runner only
// touches nodes it hasn't already processed.
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const mermaidBlockExtension: TokenizerAndRendererExtension = {
  name: "mermaidBlock",
  level: "block",
  start(src: string): number | undefined {
    const idx = src.indexOf("```mermaid");
    return idx === -1 ? undefined : idx;
  },
  tokenizer(src: string) {
    const match = MERMAID_FENCE.exec(src);
    if (!match) return undefined;
    return {
      type: "mermaidBlock",
      raw: match[0],
      text: match[1],
    };
  },
  renderer(token) {
    const source = typeof token.text === "string" ? token.text : "";
    return `<pre class="mermaid" data-mermaid-pending="1">${escapeHtml(source)}</pre>\n`;
  },
};

export const mermaidExtension: MarkedExtension = {
  extensions: [mermaidBlockExtension],
};
