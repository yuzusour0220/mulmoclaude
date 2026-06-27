// User-supplied list of extra collection registries (`config/collections-registries.json`).
// The official receptron/mulmoclaude-collections registry is always loaded; this
// file adds more on top so a community / org / private registry shows up in the
// same Discover catalog.
//
// Shape on disk:
//   [
//     { "name": "myorg", "indexUrl": "https://...", "rawBaseUrl": "https://..." }
//   ]
//
// Validation rules (a bad entry is dropped + logged; the rest still load):
//   - `name` matches `[A-Za-z0-9][A-Za-z0-9_-]{0,31}` and is NOT the reserved
//     `official` (which is always synthesized by client.ts)
//   - Both URLs are HTTPS, parseable, and have no userinfo/credentials
//   - Names are unique (later duplicates are dropped, first wins)
//
// Pure read + parse — no network. Caller invalidates by re-reading the file.

import { readWorkspaceTextSync } from "../../utils/files/workspace-io.js";
import { WORKSPACE_FILES } from "../paths.js";
import { isRecord } from "../../utils/types.js";
import { log } from "../../system/logger/index.js";

export interface RegistryConfigEntry {
  /** Short label shown on Discover cards + used as the routing key. */
  name: string;
  /** Absolute HTTPS URL of the registry's index.json. */
  indexUrl: string;
  /** Absolute HTTPS base for per-collection files (no trailing slash). */
  rawBaseUrl: string;
}

/** Reserved name for the official registry. The client always synthesizes one
 *  entry under this name; user config that re-uses it is rejected. */
export const OFFICIAL_REGISTRY_NAME = "official";

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;

function isValidHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "") return false;
  return true;
}

function parseEntry(value: unknown, index: number): RegistryConfigEntry | string {
  if (!isRecord(value)) return `entry[${index}] is not an object`;
  const { name, indexUrl, rawBaseUrl } = value;
  if (typeof name !== "string" || !NAME_RE.test(name)) {
    return `entry[${index}].name must match ${NAME_RE.source}`;
  }
  if (name === OFFICIAL_REGISTRY_NAME) {
    return `entry[${index}].name "${OFFICIAL_REGISTRY_NAME}" is reserved`;
  }
  if (!isValidHttpsUrl(indexUrl)) return `entry[${index}].indexUrl must be a valid HTTPS URL (no credentials)`;
  if (!isValidHttpsUrl(rawBaseUrl)) return `entry[${index}].rawBaseUrl must be a valid HTTPS URL (no credentials)`;
  // `rawBaseUrl` gets joined as `${rawBaseUrl}/<path>` downstream — a query or
  // fragment would land in the middle of the composed URL and break every
  // collection-file fetch on that registry (CodeRabbit review on #1837). The
  // index URL is fetched directly so a query is fine there; only rawBase
  // needs the constraint.
  if (rawBaseUrl.includes("?") || rawBaseUrl.includes("#")) {
    return `entry[${index}].rawBaseUrl must not contain a query (?) or fragment (#) — it's joined as a path prefix`;
  }
  // Strip trailing slashes so `${rawBaseUrl}/${path}` joins cleanly regardless
  // of what the user wrote. Plain-loop trim instead of a regex — the linter
  // flags any unanchored-quantifier regex as ReDoS-suspect even when it's
  // safe, and the loop is just as clear at this size.
  let normalizedRawBase = rawBaseUrl;
  while (normalizedRawBase.endsWith("/")) normalizedRawBase = normalizedRawBase.slice(0, -1);
  return { name, indexUrl, rawBaseUrl: normalizedRawBase };
}

/** Parse the JSON text of `config/collections-registries.json`. Bad entries
 *  drop with a warning; valid entries are returned in source order. Exported
 *  for unit testing — the I/O wrapper `loadRegistriesConfig` below reads the
 *  workspace file and delegates here. */
export function parseRegistriesConfig(raw: unknown): RegistryConfigEntry[] {
  if (!Array.isArray(raw)) {
    log.warn("collections-registry", "registries config is not an array — ignoring");
    return [];
  }
  const seen = new Set<string>();
  const out: RegistryConfigEntry[] = [];
  for (let i = 0; i < raw.length; i++) {
    const parsed = parseEntry(raw[i], i);
    if (typeof parsed === "string") {
      log.warn("collections-registry", "registry config entry rejected", { reason: parsed });
      continue;
    }
    if (seen.has(parsed.name)) {
      log.warn("collections-registry", "registry config duplicate name dropped", { name: parsed.name });
      continue;
    }
    seen.add(parsed.name);
    out.push(parsed);
  }
  return out;
}

/** Read `config/collections-registries.json` from the workspace. Missing file
 *  ⇒ empty list (the most common case — most users only want the official
 *  registry). Malformed JSON or rejected entries log but never throw. */
export function loadRegistriesConfig(): RegistryConfigEntry[] {
  const text = readWorkspaceTextSync(WORKSPACE_FILES.collectionsRegistries);
  if (text === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    log.warn("collections-registry", "registries config is not valid JSON — ignoring", {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
  return parseRegistriesConfig(parsed);
}
