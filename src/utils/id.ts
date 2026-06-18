// Client-side ID helpers. Mirrors `server/utils/id.ts` for the
// frontend — see issue #723 for the full design rationale.
//
// `makeUuid()` backs the per-action tool-call `uuid` fields emitted by
// `src/plugins/*/index.ts`. (The UI-side `shortHexId()` for collection record
// naming now lives in `@mulmoclaude/collection-plugin`, with CollectionView.)

/**
 * Full UUID v4 (36 chars, hyphenated).
 *
 * Used as the per-action `uuid` on ToolResult payloads so the
 * renderer can track which action a result belongs to across a
 * session.
 */
export function makeUuid(): string {
  return crypto.randomUUID();
}
