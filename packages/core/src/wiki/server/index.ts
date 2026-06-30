// Node-only wiki helpers (need `node:path`) — kept off the
// browser-safe `@mulmoclaude/core/wiki` surface. Today: the
// abs-path → slug resolver used by the host's wiki-write
// chokepoint and the PostToolUse snapshot hook.

export { wikiSlugFromAbsPath } from "./paths.js";
