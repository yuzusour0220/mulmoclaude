// Pure resolution for `backlinks` fields (plan step ② of
// plans/collection-ontology.md): the display-only reverse side of `ref`.
// Both the server enrichment (`server/derive.ts`) and the client detail
// view derive the row set through THESE helpers, so the LLM (getItems)
// and the user (record panel) always see the same rows — the same
// single-implementation rule `deriveAll` follows for formulas. No zod,
// no I/O; safe for the browser barrel.

import { whenMatches } from "./actionVisible";
import type { CollectionFieldSpec, CollectionItem } from "./schema";

/** The `backlinks` member of the field-spec union. */
export type BacklinksFieldSpec = Extract<CollectionFieldSpec, { type: "backlinks" }>;

/** The SOURCE records whose `via` field stores `recordId` (compared as
 *  strings, like every ref deref), with the optional `filter` applied —
 *  in the source items' given order. Fail-soft by construction: a `via`
 *  key that doesn't exist on the source records simply matches nothing.
 *  Callers pass DERIVED source records, so a `filter`/`display` on a
 *  derived column works when its formula is SELF-CONTAINED (an invoice
 *  `total` = sum over its own line items); a source column that derefs
 *  yet another collection stays absent — the same each-record-derives-
 *  against-itself rule ref targets follow. */
export function backlinkRows(spec: Pick<BacklinksFieldSpec, "via" | "filter">, recordId: string, sourceItems: CollectionItem[]): CollectionItem[] {
  if (!recordId) return [];
  return sourceItems.filter((item) => String(item[spec.via] ?? "") === recordId && whenMatches(spec.filter, item));
}

/** Project one backlink row to the keys consumers surface: the source
 *  collection's primaryKey (rows must stay addressable — it's the link
 *  target) plus the declared `display` columns. Keys the row doesn't
 *  carry are simply absent, mirroring `projectFields` in getItems. */
export function projectBacklinkRow(row: CollectionItem, display: readonly string[], primaryKey: string): CollectionItem {
  const keys = display.includes(primaryKey) ? display : [primaryKey, ...display];
  return Object.fromEntries(keys.filter((key) => key in row).map((key) => [key, row[key]]));
}
