// Aggregation-query executor for FILE-BACKED collections: the same DSL
// (`core/queryZ.ts`) and the same DuckDB engine as the CSV store, run
// over a temp JSONL of the collection's rows. Deliberately takes
// ALREADY-LOADED rows rather than pointing DuckDB at the record files,
// for two correctness reasons:
//
//   1. **Computed fields.** Stored record files never contain `derived` /
//      `rollup` / `toggle` values — the caller passes ENRICHED rows
//      (`listItems` → `enrichItems`), so "sum of invoice totals" works
//      even when `total` is a formula.
//   2. **The symlink defense.** A `read_json('<dataDir>/*.json')` glob
//      would follow a symlinked record file (the exact file-disclosure
//      hole `listItems`' lstat check closes) — DuckDB only ever sees
//      content that already passed the guarded reader.
//
// The temp JSONL lives in the same 0700 cache dir as CSV decode copies,
// is written 0600 (shared OS tmpdir), and is unlinked when the query
// finishes. Caller wiring lives in `manageTool.ts` (NOT `store.ts` —
// enrichment lives in `derive.ts`, which itself consumes `storeFor`, so
// wiring it into the store would create an import cycle).

import { mkdir, unlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import type { CollectionItem } from "../core/schema";
import type { CollectionQuery } from "../core/queryZ";
import { compileJsonlQuery } from "./csvQuery";
import { cacheDir, normalizeCsvValue, queryCsv } from "./csvStore";

/** Run a validated query over enriched collection rows. An empty
 *  collection short-circuits to `[]` — DuckDB has no file to infer a
 *  schema from, and "no rows" is the honest answer for every query
 *  shape (a global count over nothing reads better as absent than as a
 *  fabricated `{n: 0}` row with no other columns). */
export async function runQueryOverRows(rows: CollectionItem[], query: CollectionQuery): Promise<Record<string, unknown>[]> {
  if (rows.length === 0) return [];
  await mkdir(cacheDir(), { recursive: true, mode: 0o700 });
  const jsonlPath = path.join(cacheDir(), `q-${randomBytes(8).toString("hex")}.jsonl`);
  await writeFile(jsonlPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, { encoding: "utf-8", mode: 0o600 });
  try {
    const { sql, params } = compileJsonlQuery(query);
    const result = await queryCsv(sql, [jsonlPath, ...params]);
    return result.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normalizeCsvValue(value)])));
  } finally {
    await unlink(jsonlPath).catch(() => undefined);
  }
}
