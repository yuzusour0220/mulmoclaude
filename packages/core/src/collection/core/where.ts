// Pure SQL-like `where` predicate for `dynamicIcon` (see
// `DynamicIconSource.where` / `DynamicIconRule.where` in `./schema`).
// An AND of typed conditions — richer than the single-field `CollectionWhen`
// used elsewhere (fields/actions via `./actionVisible`), which stays as-is
// for its existing callers. No fs, no host state.

/** Comparison operators one `WhereCond` may apply to `record[field]`. */
export type WhereOp = "eq" | "ne" | "in" | "gt" | "gte" | "lt" | "lte" | "contains";

/** One typed condition: `record[field] <op> value`. `value` is a plain
 *  string for every op except `in`, which takes the allowed set. */
export interface WhereCond {
  field: string;
  op: WhereOp;
  value: string | string[];
}

/** A `where` clause is the AND of its conditions — every one must match. */
export type Where = WhereCond[];

/** True when `record[field]` is absent (`undefined`/`null`) — the only case
 *  where `ne` and every other op disagree on the result. */
function isMissing(raw: unknown): boolean {
  return raw === undefined || raw === null;
}

function matchesNumericOp(op: "gt" | "gte" | "lt" | "lte", a: number, b: number): boolean {
  if (op === "gt") return a > b;
  if (op === "gte") return a >= b;
  if (op === "lt") return a < b;
  return a <= b;
}

function matchesNumeric(op: "gt" | "gte" | "lt" | "lte", v: string, value: string | string[]): boolean {
  const a = Number(v);
  const b = Number(value);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return matchesNumericOp(op, a, b);
}

/** True when the present string value `v` satisfies `cond` (field known to
 *  exist — MISSING is handled by the caller before this runs). */
function matchesPresent(cond: WhereCond, v: string): boolean {
  switch (cond.op) {
    case "eq":
      return v === String(cond.value);
    case "ne":
      return v !== String(cond.value);
    case "in":
      return (cond.value as string[]).includes(v);
    case "contains":
      return v.includes(String(cond.value));
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return matchesNumeric(cond.op, v, cond.value);
    default:
      return false;
  }
}

/** True when `record` satisfies one condition. A MISSING field
 *  (`undefined`/`null`) matches only `ne` (vacuously true — "not equal to
 *  X" holds when there's no value at all); every other op is false. */
function matchesCond(cond: WhereCond, record: Record<string, unknown>): boolean {
  const raw = record[cond.field];
  if (isMissing(raw)) return cond.op === "ne";
  return matchesPresent(cond, String(raw));
}

/** True when `record` satisfies every condition in `where` (AND). An empty
 *  `where` matches everything. */
export function matchesWhere(where: Where, record: Record<string, unknown>): boolean {
  return where.every((cond) => matchesCond(cond, record));
}
