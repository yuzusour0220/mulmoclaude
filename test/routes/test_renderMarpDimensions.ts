// Covers the PRODUCTION PDF sizing path. `renderMarpPdf`
// (server/api/routes/pdf.ts) no longer parses dimensions itself — it reads
// slideWidth/slideHeight from the shared `renderMarpDeck({ inlineSVG: true })`
// (@mulmoclaude/markdown-plugin → render/marp.ts), which extracts Marp's SVG
// viewBox. This asserts that real decks render at their declared `size:` and
// that out-of-range / non-deck inputs fall back safely to 16:9 1280×720, so the
// shared-core refactor stays covered (replaces the old test_pdfMarpDimensions
// suite that only exercised pdf.ts's now-removed extractSlideDimensions).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderMarpDeck } from "@mulmoclaude/markdown-plugin";

function deck(size?: string): string {
  const frontmatter = ["marp: true", size ? `size: ${size}` : ""].filter(Boolean).join("\n");
  return `---\n${frontmatter}\n---\n# Slide A\n\n---\n\n# Slide B`;
}

async function pdfDims(markdown: string): Promise<{ w: number; h: number }> {
  const { slideWidth, slideHeight } = await renderMarpDeck(markdown, { inlineSVG: true });
  return { w: slideWidth, h: slideHeight };
}

describe("renderMarpDeck — PDF (viewBox) slide dimensions", () => {
  it("defaults to 16:9 1280×720", async () => {
    assert.deepEqual(await pdfDims(deck()), { w: 1280, h: 720 });
  });

  it("honours size: 4:3 → 960×720", async () => {
    assert.deepEqual(await pdfDims(deck("4:3")), { w: 960, h: 720 });
  });

  it("honours size: 9:16 portrait → 1080×1920 (custom-size bridge)", async () => {
    assert.deepEqual(await pdfDims(deck("9:16")), { w: 1080, h: 1920 });
  });

  it("honours a custom WxH canvas → 1920×1080", async () => {
    assert.deepEqual(await pdfDims(deck("1920x1080")), { w: 1920, h: 1080 });
  });

  it("accepts the 3840 max boundary → 3840×2160", async () => {
    assert.deepEqual(await pdfDims(deck("3840x2160")), { w: 3840, h: 2160 });
  });

  it("falls back to default for an over-range size (DoS guard)", async () => {
    // Marp rejects sizes beyond its limit, so the deck renders at the safe
    // default instead of forwarding 5000px into Puppeteer's viewport / pdf size.
    assert.deepEqual(await pdfDims(deck("5000x3000")), { w: 1280, h: 720 });
  });

  it("falls back to default for non-Marp markdown", async () => {
    assert.deepEqual(await pdfDims("# just a heading, no marp frontmatter"), { w: 1280, h: 720 });
  });
});

describe("renderMarpDeck — preview (CSS) mode", () => {
  it("returns positive slide dimensions in inlineSVG:false mode", async () => {
    const { slideWidth, slideHeight } = await renderMarpDeck(deck("4:3"), { inlineSVG: false });
    assert.ok(slideWidth > 0 && slideHeight > 0, `expected positive dims, got ${slideWidth}×${slideHeight}`);
  });
});
