// Pure marked → HTML tests for the mermaid block extension.
// Verifies the fence rewrite and its non-interference with regular
// code fences. Mermaid runtime is NOT imported here — this file
// stays browser-free so the node:test runner can execute it.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Marked } from "marked";
import { mermaidExtension } from "../../../src/utils/markdown/mermaidExtension";

function markedWithMermaid(): Marked {
  const instance = new Marked();
  instance.use(mermaidExtension);
  return instance;
}

describe("mermaidExtension", () => {
  it("rewrites a mermaid fence into a `<pre class=mermaid>` placeholder", () => {
    const source = "```mermaid\ngraph TB\n  A-->B\n```\n";
    const html = markedWithMermaid().parse(source) as string;
    assert.match(html, /<pre class="mermaid" data-mermaid-pending="1">/);
    assert.match(html, /graph TB/);
    assert.match(html, /A--&gt;B/);
    assert.doesNotMatch(html, /<code[^>]*language-mermaid/);
  });

  it("preserves the mermaid source characters via HTML-entity escaping", () => {
    const source = '```mermaid\nA["<script>alert(1)</script>"]-->B\n```\n';
    const html = markedWithMermaid().parse(source) as string;
    // Angle brackets and quotes must be escaped so no live <script>
    // reaches the DOM — the runtime reads .textContent so the raw
    // string is recovered before it goes to mermaid.render.
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  });

  it("does not touch non-mermaid code fences", () => {
    const source = "```ts\nconst x = 1;\n```\n";
    const html = markedWithMermaid().parse(source) as string;
    assert.doesNotMatch(html, /class="mermaid"/);
    assert.match(html, /<pre>?<code[^>]*language-ts/);
  });

  it("falls back to plain marked when a mermaid fence is missing its closing ```", () => {
    // Unterminated fence — the extension tokenizer returns undefined
    // so marked's default block scanner handles it. The output
    // shouldn't contain the mermaid placeholder class.
    const source = "```mermaid\ngraph TB\n  A-->B\n";
    const html = markedWithMermaid().parse(source) as string;
    assert.doesNotMatch(html, /class="mermaid"/);
  });

  it("handles an empty mermaid body without crashing", () => {
    const source = "```mermaid\n\n```\n";
    const html = markedWithMermaid().parse(source) as string;
    assert.match(html, /<pre class="mermaid" data-mermaid-pending="1"><\/pre>/);
  });

  it("keeps surrounding paragraphs intact", () => {
    const source = "before\n\n```mermaid\ngraph TB\n  A-->B\n```\n\nafter\n";
    const html = markedWithMermaid().parse(source) as string;
    assert.match(html, /<p>before<\/p>/);
    assert.match(html, /<p>after<\/p>/);
    assert.match(html, /<pre class="mermaid"/);
  });

  it("does not attach to inline code spans (only block fences)", () => {
    const source = "inline `mermaid graph TB` example\n";
    const html = markedWithMermaid().parse(source) as string;
    assert.doesNotMatch(html, /<pre class="mermaid"/);
    assert.match(html, /<code>mermaid graph TB<\/code>/);
  });

  it("tokenises CRLF-line-ending mermaid fences (Windows-authored)", () => {
    // Same fence as the first test but with \r\n line endings — the
    // shape a Windows editor / git checkout with autocrlf=true would
    // produce. Must produce the same placeholder as the LF case.
    const source = "```mermaid\r\ngraph TB\r\n  A-->B\r\n```\r\n";
    const html = markedWithMermaid().parse(source) as string;
    assert.match(html, /<pre class="mermaid" data-mermaid-pending="1">/);
    assert.match(html, /graph TB/);
    assert.match(html, /A--&gt;B/);
  });
});
