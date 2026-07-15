// Pure slug / record-id character rules. Shared by the isomorphic schema
// validator (`./schemaZ`) — which must stay node-free — and the server-side
// path sanitisers (`../server/paths`), which wrap these patterns with the
// `path.basename` round-trip CodeQL recognises as a `js/path-injection`
// sanitiser. Both layers MUST gate on the same patterns; importing them from
// here is what keeps them in sync.

// Same regex as `server/workspace/skills/catalog.ts#SAFE_SLUG_PATTERN`
// — keep them in sync. Bounded character classes, no nested
// quantifiers; ReDoS-safe.
// eslint-disable-next-line security/detect-unsafe-regex -- non-overlapping character classes, no catastrophic backtracking
export const SAFE_SLUG_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]*[a-zA-Z0-9])?$/;

// Record ids are a superset of slugs: they're only ever filename stems
// (`<id>.json`), never directory names or URL segments, so they may carry
// dots — natural keys like a Slack ts (`1718900000.123456`), a SemVer
// (`1.2.3`), or a decimal timestamp. The interior class adds `.` to the slug
// set; the explicit `..` reject in `isSafeRecordId` keeps a
// parent-dir-looking segment out while still allowing repeated `-`/`_`
// (`a--b`, `a__b`). Start/end stay alphanumeric so leading/trailing dots
// (hidden files, the special `.`/`..` names) and `..`-only ids are all
// excluded.
// eslint-disable-next-line security/detect-unsafe-regex -- non-overlapping character classes, no catastrophic backtracking
export const SAFE_RECORD_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_.-]*[a-zA-Z0-9])?$/;

/** True when `value` is a well-formed collection slug (alphanumeric /
 *  hyphen / underscore, no path separators). The pattern admits no `/`,
 *  `\`, or `.`, so a passing value is trivially also a safe basename —
 *  validation callers need no `path.basename` round-trip (path-building
 *  callers use `../server/paths#safeSlugName`, which adds it). */
export function isSafeSlug(value: string): boolean {
  return typeof value === "string" && SAFE_SLUG_PATTERN.test(value);
}

/** True when `value` is a well-formed record id (slug charset plus interior
 *  dots), with any `..` substring rejected explicitly. Validation-only
 *  counterpart of `../server/paths#safeRecordId`. */
export function isSafeRecordId(value: string): boolean {
  if (typeof value !== "string" || !SAFE_RECORD_ID_PATTERN.test(value)) return false;
  return !value.includes("..");
}
