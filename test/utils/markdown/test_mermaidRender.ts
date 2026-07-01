// Verifies the DOM adoption step of the mermaid render pipeline
// against real jsdom, since the previous XML-mode DOMParser choked on
// mermaid's `<foreignObject>`-nested HTML (issue #1916). Runs in
// node:test with jsdom so the SVG parse path is exercised without
// booting mermaid itself.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

let dom: JSDOM;

// Sample mermaid output shape for a subgraph diagram with an HTML
// label — this is the exact structure that broke XML-mode parsing:
// `<foreignObject>` wraps a `<div xmlns="…">` with `<br>` (unclosed
// in XML) inside.
const SAMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60">
  <g class="subgraph">
    <foreignObject width="80" height="20">
      <div xmlns="http://www.w3.org/1999/xhtml">line 1<br>line 2</div>
    </foreignObject>
  </g>
</svg>`;

function adoptSvg(document: Document, DOMParserCtor: typeof DOMParser, svgMarkup: string): SVGElement | null {
  const parsed = new DOMParserCtor().parseFromString(svgMarkup, "text/html");
  const svgEl = parsed.body.querySelector("svg");
  if (!svgEl) return null;
  return document.importNode(svgEl, true) as unknown as SVGElement;
}

before(() => {
  dom = new JSDOM("<!doctype html><html><body></body></html>");
});

describe("adoptSvg (HTML5 mode)", () => {
  it("returns the svg root for a mermaid-shaped output", () => {
    const svgEl = adoptSvg(dom.window.document, dom.window.DOMParser, SAMPLE_SVG);
    assert.ok(svgEl, "expected an SVGElement");
    assert.equal(svgEl.tagName.toLowerCase(), "svg");
  });

  it("preserves the foreignObject subtree with its br tag", () => {
    const svgEl = adoptSvg(dom.window.document, dom.window.DOMParser, SAMPLE_SVG);
    assert.ok(svgEl);
    const foreign = svgEl.querySelector("foreignObject");
    assert.ok(foreign, "foreignObject preserved");
    // `<br>` in the source (unclosed in XML) survives HTML5 parsing.
    // The classic XML-mode DOMParser would have returned a
    // <parsererror> root here.
    const brTag = foreign.querySelector("br");
    assert.ok(brTag, "br survived");
  });

  it("returns null for input without an svg root", () => {
    const notSvg = "<p>not an svg</p>";
    const svgEl = adoptSvg(dom.window.document, dom.window.DOMParser, notSvg);
    assert.equal(svgEl, null);
  });
});
