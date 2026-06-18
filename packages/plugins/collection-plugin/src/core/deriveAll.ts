// The derived-field saturation loop for schema-driven collections,
// extracted from `composables/collections/useCollectionRendering.ts` so
// the server (manageCollection getItems enrichment) and the client
// (table cells, form display) evaluate formulas through ONE
// implementation — if the two ever diverged, the UI and the LLM would
// disagree on a number. Pure module: no Vue, no I/O.
//
// Like `actionVisible.ts`, the input types are minimal structural
// shapes so both the client `FieldSpec`/`CollectionSchema`
// (src/components/collectionTypes.ts) and the server
// `CollectionFieldSpec`/`CollectionSchema`
// (server/workspace/collections/types.ts) satisfy them as-is.

import { evaluateDerived, type FormulaContext } from "./derivedFormula";

/** Minimal field shape the derive loop needs — accepts both the client
 *  FieldSpec and the server CollectionFieldSpec. */
export interface DerivableFieldSpec {
  type: string;
  /** When type === "ref": slug of the target collection. */
  to?: string;
  /** When type === "derived": formula evaluated against the record. */
  formula?: string;
}

/** Minimal schema shape: just the ordered field map. */
export interface DerivableSchema {
  fields: Record<string, DerivableFieldSpec>;
}

export type DerivableRecord = Record<string, unknown>;

/** Per-target-collection cache of loaded referenced records:
 *  target collection slug → item slug → full record. Mirrors the
 *  client's `RefRecordCache` / the server's enrichment loader. */
export type DeriveRefRecords = Record<string, Record<string, DerivableRecord>>;

/** Map each `ref` field's stored slug to its loaded target record (or
 *  null when dangling / not loaded), keyed by the LOCAL field name —
 *  the shape `evaluateDerived` reads for `<field>.<col>` derefs. */
export function resolveRowRefs(schema: DerivableSchema, record: DerivableRecord, refRecords: DeriveRefRecords): NonNullable<FormulaContext["refs"]> {
  const refs: NonNullable<FormulaContext["refs"]> = {};
  for (const [key, field] of Object.entries(schema.fields)) {
    if (field.type !== "ref" || !field.to) continue;
    const slug = record[key];
    refs[key] = typeof slug === "string" ? (refRecords[field.to]?.[slug] ?? null) : null;
  }
  return refs;
}

/** Evaluate every `derived` field against `base`, saturating so a
 *  derived field can read another derived field computed in an earlier
 *  pass (`subtotal → tax → total` converges in ≤ field-count passes).
 *  Cycles can't loop forever — passes are bounded by the number of
 *  derived fields and the loop breaks as soon as a pass changes
 *  nothing. Failed formulas stay ABSENT (the UI renders them as
 *  em-dash). Returns a copy; `base` is never mutated.
 *
 *  Derived keys already present in `base` are stripped before
 *  evaluation: computed output is host-truth, never persisted-input
 *  fallback. A record JSON can carry a stale (or forged) derived value
 *  — raw Write/Edit, legacy data — and without the strip, a failing
 *  formula would silently surface that value as if the host computed
 *  it. */
export function deriveAll(schema: DerivableSchema, base: DerivableRecord, refRecords: DeriveRefRecords): DerivableRecord {
  const derivedKeys = new Set(Object.keys(schema.fields).filter((key) => schema.fields[key]?.type === "derived"));
  const enriched: DerivableRecord = Object.fromEntries(Object.entries(base).filter(([key]) => !derivedKeys.has(key)));
  const refs = resolveRowRefs(schema, base, refRecords);
  const maxPasses = Object.values(schema.fields).filter((field) => field.type === "derived").length;
  for (let pass = 0; pass < maxPasses; pass++) {
    let mutated = false;
    for (const [key, field] of Object.entries(schema.fields)) {
      if (field.type !== "derived" || !field.formula) continue;
      const next = evaluateDerived(field.formula, { record: enriched, refs });
      if (next !== null && enriched[key] !== next) {
        enriched[key] = next;
        mutated = true;
      }
    }
    if (!mutated) break;
  }
  return enriched;
}
