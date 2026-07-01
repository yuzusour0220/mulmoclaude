// Duplicate of the host's `src/utils/markdown/mermaidRender.ts` —
// the plugin ships its own `mermaid` dep so the dynamic import
// resolves inside the plugin bundle rather than reaching into the
// host. Kept in sync with the host module; edits here should mirror
// there.

type MermaidRuntime = typeof import("mermaid").default;

let mermaidPromise: Promise<MermaidRuntime> | null = null;

async function loadMermaid(): Promise<MermaidRuntime> {
  if (mermaidPromise) return mermaidPromise;
  const attempt = import("mermaid").then((mod) => {
    const mermaid = mod.default;
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "default" });
    return mermaid;
  });
  // Reset the cache on rejection so a transient import failure
  // (offline / stale chunk after deploy) can be retried by the next
  // fence to render, matching the host module's contract.
  attempt.catch(() => {
    if (mermaidPromise === attempt) mermaidPromise = null;
  });
  mermaidPromise = attempt;
  return attempt;
}

function placeLoadError(nodes: HTMLElement[], err: unknown): void {
  for (const node of nodes) {
    const errBox = document.createElement("pre");
    errBox.className = "mermaid-error";
    errBox.textContent = `Mermaid failed to load: ${String(err)}`;
    node.replaceWith(errBox);
  }
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
  let mermaid: MermaidRuntime;
  try {
    mermaid = await loadMermaid();
  } catch (err) {
    placeLoadError(nodes, err);
    return;
  }
  await Promise.all(nodes.map((node) => renderOne(node, mermaid)));
}
