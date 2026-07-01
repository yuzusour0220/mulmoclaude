// Duplicate of the host's `src/utils/markdown/mermaidExtension.ts` —
// the plugin ships its own bundled `marked` (see package.json), so it
// cannot reach across to the host module without pulling the whole
// host into the plugin bundle. Kept in sync manually; if the shape
// changes on one side, update the other.

import type { MarkedExtension, TokenizerAndRendererExtension } from "marked";

// `\r?\n` at every line-ending anchor so a Windows-authored source
// (CRLF line endings) tokenises identically to a Unix source.
const MERMAID_FENCE = /^```mermaid[ \t]*\r?\n([\s\S]*?)\r?\n```(?:\r?\n|$)/;

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
