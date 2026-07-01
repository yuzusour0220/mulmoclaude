# feat #1904: render mermaid diagrams in markdown viewers

## User prompt (JP)

> markdown viewer でマーメイドも表示させたい

Scope confirmed via follow-up: **host + markdown-plugin** (all viewers), **lazy load** on first mermaid fence.

## Design

Two components:

1. **marked block extension** — matches `\`\`\`mermaid\n…\n\`\`\`` fences at the block level and short-circuits them into `<pre class="mermaid" data-mermaid-pending="1">SOURCE</pre>`. Registered BEFORE `markedHighlightExtension` so highlight.js never sees a mermaid fence (which it would otherwise render as plaintext).

2. **mermaid runner** — `renderMermaidNodes(root)` scans for `pre.mermaid[data-mermaid-pending]`, lazy dynamic-imports `mermaid` on first hit, initialises once with `startOnLoad: false, securityLevel: "strict", theme: "default"`, and per node calls `mermaid.render(uniqueId, textContent)` → replaces the `<pre>` in place with a `<div class="mermaid-diagram">` wrapping the returned SVG. On parse error the node becomes a `<pre class="mermaid-error">` showing diagnostic + source.

3. **Vue composable** — `useMermaidRenderer(containerRef, sourceRef)` schedules a `nextTick` → `renderMermaidNodes` on mount and on `sourceRef` change.

### Sanitiser interaction

Some viewers (`skill/View.vue`, `manageSkills/View.vue`) sanitise via `sanitizeMarkdownHtml` (DOMPurify). Default DOMPurify config keeps `<pre>` + `class` + `data-*` intact, so the placeholder survives sanitisation. The SVG that mermaid injects post-render bypasses the sanitiser (it goes into a live DOM node via `node.replaceWith(...)`) — this matches how `wikiEmbedHandlers.ts` iframes work today.

### Files added

#### Host (`src/utils/markdown/`)

- `mermaidExtension.ts` — the marked block extension (pure, no runtime deps beyond `marked` for types).
- `mermaidRender.ts` — the lazy loader + `renderMermaidNodes(root)`.
- `useMermaid.ts` — the composable.

#### Plugin (`packages/plugins/markdown-plugin/src/utils/markdown/`)

- Same three modules copied over. The plugin ships its own bundled `marked` + own version of the wiring, so we duplicate rather than import from the host (avoids uphill dependency violating the plugin/host boundary rule in CLAUDE.md).

### Files modified

#### Host

- `src/utils/markdown/setup.ts` — `marked.use(mermaidExtension)` registered before `markedHighlightExtension`.
- `src/plugins/textResponse/View.vue` — add container ref + `useMermaidRenderer`.
- `src/plugins/textResponse/Preview.vue` — same.
- `src/plugins/wiki/components/WikiPageBody.vue` — same (already has `rootRef`).
- `src/plugins/skill/View.vue` — same.
- `src/plugins/manageSkills/View.vue` — same, wired for both `renderedBody` and `catalogRenderedBody`.

#### Plugin

- `packages/plugins/markdown-plugin/src/plugins/markdown/View.vue` — configure the plugin-local `marked` with the extension + wire the composable.
- `packages/plugins/markdown-plugin/package.json` — add `mermaid` dep, bump `version`.

### Tests

- `test/utils/markdown/test_mermaidExtension.ts` — pure marked→html transform: mermaid fence → `<pre class="mermaid" data-mermaid-pending="1">…</pre>`; non-mermaid fence unchanged; malformed fence (unclosed) falls back to marked default; empty body handled. No mermaid runtime import.

### Manual verification

Playwright:
1. Open dev server / chat.
2. Paste a mermaid fence into a session (`graph TB; A-->B`).
3. Snapshot the response body — expect an inline SVG under `.mermaid-diagram`.
4. Regression check: paste a plain `\`\`\`js` fence, confirm highlight.js styling still applies.

## What is NOT changed

- No mermaid theme picker. Default theme, matches app light background.
- No error retry UI. A malformed fence renders a static error block.
- No mermaid support in `<code>` (inline) — only block fences.
