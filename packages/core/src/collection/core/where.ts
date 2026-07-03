// Pure SQL-like `where` predicate for `dynamicIcon` (see
// `DynamicIconSource.where` / `DynamicIconRule.where` in `./schema`).
// An AND of typed conditions — richer than the single-field `CollectionWhen`
// used elsewhere (fields/actions via `./actionVisible`), which stays as-is
// for its existing callers. No fs, no host state.

/** Comparison operators one `WhereCond` may apply to `record[field]`. */
export type WhereOp = "eq" | "ne" | "in" | "gt" | "gte" | "lt" | "lte" | "contains";

/** Reads the comparison value from a field instead of a schema literal:
 *  - `record` set → another record: `recordsById[record][field]` (e.g. a
 *    `_config` singleton's `defaultCity`, following a per-user setting);
 *  - `record` omitted → the SAME record being matched (field-to-field, e.g.
 *    `spent > budget`). */
export interface ValueRef {
  record?: string;
  field: string;
}

/** One typed condition: `record[field] <op> value`. The comparison value is
 *  either a literal `value` (a plain string for every op except `in`, which
 *  takes the allowed set) or a `valueFrom` reference resolved against the
 *  `recordsById` map passed to `matchesWhere`. Exactly one of the two is
 *  expected — enforced by zod at the schema boundary (`server/discovery.ts`),
 *  not here. */
export interface WhereCond {
  field: string;
  op: WhereOp;
  value?: string | string[];
  valueFrom?: ValueRef;
}

/** A `where` clause is the AND of its conditions — every one must match. */
export type Where = WhereCond[];

/** True when `record[field]` is absent (`undefined`/`null`) — the only case
 *  where `ne` and every other op disagree on the result. */
function isMissing(raw: unknown): boolean {
  return raw === undefined || raw === null;
}

/** The effective comparison value for `cond`: its literal `value`, or — for
 *  a `valueFrom` reference — the target field read out of `recordsById`.
 *  `undefined` means UNRESOLVED (no such record, or the field on it is
 *  missing); the caller must treat that as "never matches", not as a
 *  literal `undefined` value to compare against. */
function resolveValue(cond: WhereCond, record: Record<string, unknown>, recordsById: Record<string, Record<string, unknown>>): string | string[] | undefined {
  if (!cond.valueFrom) return cond.value;
  const { record: refRecord, field } = cond.valueFrom;
  const target = refRecord === undefined ? record : recordsById[refRecord];
  const raw = target?.[field];
  return isMissing(raw) ? undefined : String(raw);
}

function matchesNumericOp(op: "gt" | "gte" | "lt" | "lte", a: number, b: number): boolean {
  if (op === "gt") return a > b;
  if (op === "gte") return a >= b;
  if (op === "lt") return a < b;
  return a <= b;
}

/** `Number("")` / `Number("  ")` are `0`, not `NaN`, so treat a blank string
 *  as non-numeric explicitly — an empty field must fail a numeric compare,
 *  not read as zero. */
function toNumber(raw: string): number {
  return raw.trim() === "" ? NaN : Number(raw);
}

function matchesNumeric(op: "gt" | "gte" | "lt" | "lte", v: string, value: string | string[]): boolean {
  if (Array.isArray(value)) return false;
  const a = toNumber(v);
  const b = toNumber(value);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return matchesNumericOp(op, a, b);
}

/** True when the present string value `v` satisfies `op` against the
 *  resolved `value` (field known to exist — MISSING is handled by the
 *  caller before this runs, and an UNRESOLVED `valueFrom` never reaches
 *  here either). */
function matchesPresent(op: WhereOp, v: string, value: string | string[]): boolean {
  switch (op) {
    case "eq":
      return v === String(value);
    case "ne":
      return v !== String(value);
    case "in":
      return (value as string[]).includes(v);
    case "contains":
      return v.includes(String(value));
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return matchesNumeric(op, v, value);
    default:
      return false;
  }
}

/** True when `record` satisfies one condition, given `recordsById` to
 *  resolve a `valueFrom` reference. Two independent MISSING cases, checked
 *  in order:
 *  - `record[cond.field]` absent (`undefined`/`null`) → matches only `ne`
 *    (vacuously true — "not equal to X" holds when there's no value at
 *    all); every other op is false. Unchanged from the literal-`value`
 *    behaviour, regardless of whether `valueFrom` would also resolve.
 *  - the resolved comparison value is UNRESOLVED (a `valueFrom` whose
 *    target record/field doesn't exist) → false for EVERY op, including
 *    `ne` — a broken reference must never spuriously match. */
function matchesCond(cond: WhereCond, record: Record<string, unknown>, recordsById: Record<string, Record<string, unknown>>): boolean {
  const raw = record[cond.field];
  if (isMissing(raw)) return cond.op === "ne";
  const value = resolveValue(cond, record, recordsById);
  if (value === undefined) return false;
  return matchesPresent(cond.op, String(raw), value);
}

/** True when `record` satisfies every condition in `where` (AND). An empty
 *  `where` matches everything. `recordsById` — the source collection's
 *  records keyed by primaryKey — resolves any `valueFrom` reference;
 *  omitted (default `{}`) for callers with no cross-record lookups, in
 *  which case every `valueFrom` condition is UNRESOLVED and so never
 *  matches. */
export function matchesWhere(where: Where, record: Record<string, unknown>, recordsById: Record<string, Record<string, unknown>> = {}): boolean {
  return where.every((cond) => matchesCond(cond, record, recordsById));
}
