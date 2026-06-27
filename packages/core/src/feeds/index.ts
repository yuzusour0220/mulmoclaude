// @mulmoclaude/core/feeds — isomorphic surface of the Feeds module: the
// declarative ingest vocabulary/types and the pure path helpers. Safe to import
// from a browser bundle (no node-only I/O). The retrieval engine + host DI live
// on the server-only `@mulmoclaude/core/feeds/server` subpath.

export * from "./ingestTypes.js";
export * from "./paths.js";
