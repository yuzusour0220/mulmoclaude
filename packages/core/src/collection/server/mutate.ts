// Execute a `kind: "mutate"` action (plan step ④ of
// plans/collection-ontology.md): the HOST applies a declarative,
// merge-semantics write to one record — no LLM, no tokens. The pipeline
// deliberately reuses the governed write path's pieces, never a third
// mechanism:
//
//   1. params  — the mini-form is validated per spec by the SAME
//      compiled record checks `putItems` uses (`recordFieldProblem`,
//      strict tier: required/enum plus typed values, since a form
//      rejects rather than lints);
//   2. merge   — the resolved `set` merges over the stored record with
//      computed keys stripped (healing stale copies, exactly like
//      manageCollection's `mode: "merge"`);
//   3. gate    — `validateRecordObject`, the same write gate every
//      governed path runs;
//   4. write   — `writeItem` (atomic, change-publishing).
//
// The `require` state gate is enforced by the CALLER (the route, via
// `actionVisible` against the record it already read) — visibility is
// the authorization rule, shared with the chat/agent kinds.

import { COMPUTED_TYPES, recordFieldProblem } from "../core/recordZ";
import { resolveMutateSet } from "../core/mutateAction";
import { readItem, writeItem, type IoOptions } from "./io";
import { validateRecordObject } from "./validate";
import type { LoadedCollection } from "./discoveredCollection";
import type { CollectionItem, CollectionMutateAction } from "../core/schema";

export type MutateActionOutcome =
  | { ok: true; item: CollectionItem }
  /** `status` picks the HTTP mapping: bad params / a write-gate reject are
   *  the caller's 400s, a missing record its 404, a refused write its 500. */
  | { ok: false; status: "invalid-params" | "invalid-record" | "not-found" | "write-refused"; problem: string };

/** First problem with the submitted params, or null. Every declared param
 *  is checked by the shared record-field validator; keys the action never
 *  declared are rejected outright — a stray key would otherwise ride the
 *  resolved `set` semantics silently. */
export function firstMutateParamProblem(action: CollectionMutateAction, params: Record<string, unknown>): string | null {
  const declared = action.params ?? {};
  for (const key of Object.keys(params)) {
    if (declared[key] === undefined) return `unknown param '${key}' — not declared by action '${action.id}'`;
  }
  for (const [key, spec] of Object.entries(declared)) {
    const problem = recordFieldProblem(key, spec, params[key], "strict");
    if (problem) return problem;
  }
  return null;
}

/** Apply one mutate action to one record. Never throws for data-shaped
 *  failures — the outcome's `problem` doubles as agent feedback when an
 *  LLM (not the user) pressed the button. */
export async function applyMutateAction(
  collection: LoadedCollection,
  action: CollectionMutateAction,
  itemId: string,
  params: Record<string, unknown>,
  opts: IoOptions = {},
): Promise<MutateActionOutcome> {
  const paramProblem = firstMutateParamProblem(action, params);
  if (paramProblem) return { ok: false, status: "invalid-params", problem: paramProblem };

  const existing = await readItem(collection.dataDir, itemId, opts);
  if (!existing) return { ok: false, status: "not-found", problem: `item '${itemId}' not found` };

  // Merge over the stored record with computed keys stripped — a legacy /
  // raw-written record can carry a stale derived/embed value, and
  // re-writing it would perpetuate a forged host-computed value.
  const stored = Object.entries(existing).filter(([key]) => {
    const spec = collection.schema.fields[key];
    return !spec || !COMPUTED_TYPES.has(spec.type);
  });
  const merged: CollectionItem = { ...Object.fromEntries(stored), ...resolveMutateSet(action.set, params) };

  const invalid = validateRecordObject(merged, itemId, collection.schema);
  if (invalid) return { ok: false, status: "invalid-record", problem: invalid };

  const result = await writeItem(collection.dataDir, itemId, merged, { workspaceRoot: opts.workspaceRoot, slug: collection.slug });
  if (result.kind !== "ok") return { ok: false, status: "write-refused", problem: `write refused (${result.kind})` };
  return { ok: true, item: merged };
}
