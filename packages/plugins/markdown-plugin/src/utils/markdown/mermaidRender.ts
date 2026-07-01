// Duplicate of the host's `src/utils/markdown/mermaidRender.ts` —
// the plugin ships its own `mermaid` dep so the dynamic import
// resolves inside the plugin bundle rather than reaching into the
// host. Kept in sync with the host module; edits here should mirror
// there.

type MermaidRuntime = typeof import("mermaid").default;

let mermaidPromise: Promise<MermaidRuntime> | null = null;

async function loadMermaid(): Promise<MermaidRuntime> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => {
      const mermaid = mod.default;
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "default" });
      return mermaid;
    });
  }
  return mermaidPromise;
}

let renderCounter = 0;
function nextRenderId(): string {
  renderCounter += 1;
  return `mulmo-mermaid-plugin-${renderCounter}`;
}

function pendingNodes(root: Element | Document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("pre.mermaid[data-mermaid-pending]"));
}

async function renderOne(node: HTMLElement, mermaid: MermaidRuntime): Promise<void> {
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

export async function renderMermaidNodes(root: Element | Document | null | undefined): Promise<void> {
  if (!root) return;
  const nodes = pendingNodes(root);
  if (nodes.length === 0) return;
  const mermaid = await loadMermaid();
  await Promise.all(nodes.map((node) => renderOne(node, mermaid)));
}
