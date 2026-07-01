// Runtime side of the mermaid pipeline: scans the DOM for
// `<pre class="mermaid" data-mermaid-pending>` placeholders written by
// `mermaidExtension.ts`, lazy-loads the mermaid runtime on the first
// hit, renders each block, and swaps the placeholder in place with
// the resulting SVG.
//
// Lazy-load: mermaid.js is heavy (~500 KB gzip). The dynamic import
// keeps it out of the initial bundle for users who never encounter a
// diagram. `mermaidPromise` memoises the module so subsequent calls
// don't re-import.

type MermaidRuntime = typeof import("mermaid").default;

let mermaidPromise: Promise<MermaidRuntime> | null = null;

async function loadMermaid(): Promise<MermaidRuntime> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => {
      const mermaid = mod.default;
      // `startOnLoad: false` — we drive rendering explicitly per node
      // instead of letting mermaid walk the document on DOMContentLoaded.
      // `securityLevel: "strict"` — mermaid sanitises its own labels and
      // will not execute user-authored HTML/JS in diagram text.
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "default" });
      return mermaid;
    });
  }
  return mermaidPromise;
}

// Distinct per-diagram DOM id. Two diagrams on one page must not collide
// (mermaid uses the id as the SVG root id).
let renderCounter = 0;
function nextRenderId(): string {
  renderCounter += 1;
  return `mulmo-mermaid-${renderCounter}`;
}

function pendingNodes(root: Element | Document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("pre.mermaid[data-mermaid-pending]"));
}

async function renderOne(node: HTMLElement, mermaid: MermaidRuntime): Promise<void> {
  // `textContent` gives us the raw source — DOMPurify preserves it
  // verbatim inside `<pre>` and we escaped it going in, so entity
  // decoding is browser-native from the DOM read.
  const source = node.textContent ?? "";
  const svgId = nextRenderId();
  try {
    const { svg } = await mermaid.render(svgId, source);
    const wrapper = document.createElement("div");
    wrapper.className = "mermaid-diagram";
    wrapper.innerHTML = svg;
    node.replaceWith(wrapper);
  } catch (err) {
    const errBox = document.createElement("pre");
    errBox.className = "mermaid-error";
    errBox.textContent = `Mermaid render failed: ${String(err)}\n---\n${source}`;
    node.replaceWith(errBox);
  }
}

/** Render every unprocessed mermaid placeholder under `root`. Safe to
 *  call repeatedly — nodes get replaced on success (no `data-*` to
 *  match a second time) and gain an `.mermaid-error` class on failure.
 *  Returns once every discovered node has been resolved. */
export async function renderMermaidNodes(root: Element | Document | null | undefined): Promise<void> {
  if (!root) return;
  const nodes = pendingNodes(root);
  if (nodes.length === 0) return;
  const mermaid = await loadMermaid();
  await Promise.all(nodes.map((node) => renderOne(node, mermaid)));
}
