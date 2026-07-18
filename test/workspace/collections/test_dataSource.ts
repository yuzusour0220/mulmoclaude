import "../../../server/workspace/collections/configure.js"; // configure @mulmoclaude/core/collection host binding for tests
// dataSource (external read-only CSV) collections — v1 of
// plans/feat-collection-csv-duckdb-source.md. Locks in:
//   (1) schema validation: dataPath/dataSource exclusivity + the
//       read-only exclusions (singleton / ingest / spawn / mutate actions);
//   (2) discovery: dataSourceFile resolution, containment, the
//       conventional phantom dataDir, and the summary `readonly` flag;
//   (3) the pure CSV helpers (id encode/decode, value normalization,
//       row→item, dedupe);
//   (4) the DuckDB-backed store end-to-end: UTF-8 + Shift_JIS files,
//       duplicate keys (last wins), encoded-id reads, missing file;
//   (5) the server-enforced write guards (manageCollection putItems,
//       remote-view mutate).

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import iconv from "iconv-lite";

import {
  collectionWritable,
  CollectionQueryZ,
  compileCsvQuery,
  csvRowToItem,
  decodeCsvRecordId,
  dedupeByRecordId,
  discoverCollections,
  encodeCsvRecordId,
  loadCollection,
  makeManageCollectionTool,
  MAX_CSV_ROWS,
  normalizeCsvValue,
  storeFor,
  toSummary,
} from "@mulmoclaude/core/collection/server";
import { createMutateRemoteView, type MutateRemoteViewDeps } from "../../../server/workspace/collections/remoteView.js";

let workdir: string;
let emptyUserDir: string;

beforeEach(() => {
  workdir = mkdtempSync(path.join(tmpdir(), "collections-datasource-"));
  emptyUserDir = mkdtempSync(path.join(tmpdir(), "collections-datasource-user-"));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
  rmSync(emptyUserDir, { recursive: true, force: true });
});

const discoveryOpts = () => ({ workspaceRoot: workdir, userSkillsDir: emptyUserDir });

function writeSkill(slug: string, schema: object | string): void {
  const dir = path.join(workdir, ".claude/skills", slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${slug}\ndescription: test fixture\n---\nbody\n`);
  writeFileSync(path.join(dir, "schema.json"), typeof schema === "string" ? schema : JSON.stringify(schema));
}

const CSV_SCHEMA = {
  title: "Students",
  icon: "school",
  dataSource: { type: "csv", path: "data/students.csv" },
  primaryKey: "student_id",
  displayField: "name",
  fields: {
    student_id: { type: "string", label: "ID", primary: true },
    name: { type: "string", label: "Name" },
    score: { type: "number", label: "Score" },
  },
};

function writeCsv(rel: string, text: string): void {
  const file = path.join(workdir, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

describe("dataSource schema validation", () => {
  it("accepts a dataSource schema and resolves dataSourceFile + phantom dataDir + readonly summary", async () => {
    writeSkill("students", CSV_SCHEMA);
    const collections = await discoverCollections(discoveryOpts());
    assert.equal(collections.length, 1);
    const [collection] = collections;
    assert.ok(collection);
    assert.equal(collection.dataSourceFile, path.resolve(workdir, "data/students.csv"));
    assert.equal(collection.dataDir, path.resolve(workdir, "data/collections/students/items"));
    assert.equal(toSummary(collection).readonly, true);
    assert.equal(collectionWritable(collection), false);
  });

  it("rejects a schema declaring BOTH dataPath and dataSource, and one declaring neither", async () => {
    writeSkill("both", { ...CSV_SCHEMA, dataPath: "data/both/items" });
    writeSkill("neither", { ...CSV_SCHEMA, dataSource: undefined });
    assert.equal((await discoverCollections(discoveryOpts())).length, 0);
  });

  it("rejects dataSource combined with write machinery (singleton / ingest / spawn / mutate action)", async () => {
    writeSkill("with-singleton", { ...CSV_SCHEMA, singleton: "me" });
    writeSkill("with-mutate", {
      ...CSV_SCHEMA,
      fields: { ...CSV_SCHEMA.fields, status: { type: "enum", label: "Status", values: ["a", "b"] } },
      actions: [{ id: "flip", label: "Flip", kind: "mutate", set: { status: "b" } }],
    });
    assert.equal((await discoverCollections(discoveryOpts())).length, 0);
  });

  it("rejects a dataSource path escaping the workspace", async () => {
    writeSkill("escape", { ...CSV_SCHEMA, dataSource: { type: "csv", path: "../outside.csv" } });
    assert.equal((await discoverCollections(discoveryOpts())).length, 0);
  });
});

describe("CSV pure helpers", () => {
  it("encodeCsvRecordId passes safe ids through and hex-encodes the rest, injectively", () => {
    assert.equal(encodeCsvRecordId("S-001"), "S-001");
    assert.equal(encodeCsvRecordId("1718900000.123456"), "1718900000.123456");
    const japanese = encodeCsvRecordId("山田001");
    assert.match(japanese, /^id0x[0-9a-f]+$/);
    assert.equal(decodeCsvRecordId(japanese), "山田001");
    // A raw value shaped like an encoded id is itself encoded, so the
    // encoded namespace can't collide with raw values.
    const shaped = encodeCsvRecordId("id0xab");
    assert.notEqual(shaped, "id0xab");
    assert.equal(decodeCsvRecordId(shaped), "id0xab");
    // Spaces are unsafe → encoded.
    assert.equal(decodeCsvRecordId(encodeCsvRecordId("a b")), "a b");
  });

  it("normalizeCsvValue converts bigint, Date, and exotic objects", () => {
    assert.equal(normalizeCsvValue(42n), 42);
    assert.equal(normalizeCsvValue(BigInt("9007199254740993")), "9007199254740993");
    assert.equal(normalizeCsvValue(new Date("2026-04-01T00:00:00.000Z")), "2026-04-01");
    assert.equal(normalizeCsvValue(new Date("2026-04-01T09:30:00.000Z")), "2026-04-01T09:30:00.000Z");
    assert.equal(normalizeCsvValue(null), null);
    assert.equal(normalizeCsvValue("x"), "x");
  });

  it("csvRowToItem overwrites the key field with the record id and skips empty keys", () => {
    const item = csvRowToItem({ student_id: "山田001", name: "山田" }, "student_id");
    assert.ok(item);
    assert.equal(item.student_id, encodeCsvRecordId("山田001"));
    assert.equal(csvRowToItem({ student_id: "", name: "x" }, "student_id"), null);
    assert.equal(csvRowToItem({ name: "no key column" }, "student_id"), null);
  });

  it("dedupeByRecordId keeps the LAST row per id", () => {
    const { items, duplicates } = dedupeByRecordId(
      [
        { id: "a", v: 1 },
        { id: "b", v: 2 },
        { id: "a", v: 3 },
      ],
      "id",
    );
    assert.equal(duplicates, 1);
    assert.deepEqual(
      items.find((item) => item.id === "a"),
      { id: "a", v: 3 },
    );
  });
});

describe("DuckDB CSV store", () => {
  it("lists a UTF-8 CSV (typed values, duplicate key last-wins) and reads by raw + encoded id", async () => {
    writeSkill("students", CSV_SCHEMA);
    writeCsv("data/students.csv", "student_id,name,score\nS-001,Alice,92\n山田001,山田 太郎,88\nS-001,Alice2,93\n");
    const collection = await loadCollection("students", discoveryOpts());
    assert.ok(collection);
    const store = storeFor(collection, { workspaceRoot: workdir });
    assert.equal(store.capabilities.writable, false);

    const items = await store.list();
    assert.equal(items.length, 2); // duplicate S-001 collapsed
    const alice = items.find((item) => item.student_id === "S-001");
    assert.equal(alice?.name, "Alice2"); // last row wins
    assert.equal(alice?.score, 93); // BIGINT → number

    const encoded = encodeCsvRecordId("山田001");
    const yamada = items.find((item) => item.student_id === encoded);
    assert.equal(yamada?.name, "山田 太郎");

    const readRaw = await store.read("S-001");
    assert.equal(readRaw?.name, "Alice2"); // read matches list's winner
    const readEncoded = await store.read(encoded);
    assert.equal(readEncoded?.name, "山田 太郎");
    assert.equal(await store.read("nope"), null);
  });

  it("decodes a Shift_JIS CSV without touching the user's file", async () => {
    writeSkill("roster", { ...CSV_SCHEMA, dataSource: { type: "csv", path: "data/roster.csv" }, title: "名簿" });
    const sjis = iconv.encode("student_id,name,score\nA-1,山田 太郎,88\nB-2,佐藤 花子,91\n", "cp932");
    const file = path.join(workdir, "data/roster.csv");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, sjis);

    const collection = await loadCollection("roster", discoveryOpts());
    assert.ok(collection);
    const items = await storeFor(collection, { workspaceRoot: workdir }).list();
    assert.equal(items.length, 2);
    assert.equal(items.find((item) => item.student_id === "A-1")?.name, "山田 太郎");
    // Source of truth untouched — still Shift_JIS bytes on disk.
    const { readFileSync } = await import("node:fs");
    assert.deepEqual(readFileSync(file), sjis);
  });

  it("keeps numeric-looking string keys textual — leading zeros survive and stay distinct", async () => {
    writeSkill("students", CSV_SCHEMA);
    writeCsv("data/students.csv", "student_id,name,score\n001,First,1\n1,Second,2\n001,Third,3\n");
    const collection = await loadCollection("students", discoveryOpts());
    assert.ok(collection);
    const store = storeFor(collection, { workspaceRoot: workdir });
    const items = await store.list();
    // "001" and "1" are DIFFERENT keys (the VARCHAR pin defeats the
    // sniffer's BIGINT coercion); the duplicate "001" collapses last-wins.
    assert.deepEqual(items.map((item) => item.student_id).sort(), ["001", "1"]);
    const zeroPadded = await store.read("001");
    assert.equal(zeroPadded?.name, "Third");
    assert.equal((await store.read("1"))?.name, "Second");
  });

  it("refuses a symlink swapped in AFTER discovery (read-time containment race)", async () => {
    // A symlink present AT discovery is already refused by resolveDataDir's
    // realpath containment (the collection never loads). This models the
    // TOCTOU race instead: discover against a legit file, then swap it for
    // a symlink pointing outside the workspace before the read.
    writeSkill("students", CSV_SCHEMA);
    writeCsv("data/students.csv", "student_id,name,score\nS-1,Legit,1\n");
    const collection = await loadCollection("students", discoveryOpts());
    assert.ok(collection);
    const outside = path.join(emptyUserDir, "outside.csv");
    writeFileSync(outside, "student_id,name,score\nS-9,Leak,0\n");
    rmSync(path.join(workdir, "data/students.csv"));
    symlinkSync(outside, path.join(workdir, "data/students.csv"));
    const store = storeFor(collection, { workspaceRoot: workdir });
    assert.deepEqual(await store.list(), []);
    assert.equal(await store.read("S-9"), null);
  });

  it("treats a missing dataSource file as an empty collection", async () => {
    writeSkill("students", CSV_SCHEMA);
    const collection = await loadCollection("students", discoveryOpts());
    assert.ok(collection);
    assert.deepEqual(await storeFor(collection, { workspaceRoot: workdir }).list(), []);
    assert.equal(await storeFor(collection, { workspaceRoot: workdir }).read("S-001"), null);
  });
});

describe("read-only write guards", () => {
  it("manageCollection putItems refuses a dataSource collection with the data-file pointer", async () => {
    writeSkill("students", CSV_SCHEMA);
    writeCsv("data/students.csv", "student_id,name,score\nS-001,Alice,92\n");
    const tool = makeManageCollectionTool(discoveryOpts());
    const result = await tool.handler({ action: "putItems", slug: "students", items: [{ student_id: "S-002", name: "Bob" }] });
    assert.match(result, /read-only/);
    assert.match(result, /data\/students\.csv/);
    // getItems still works through the same tool.
    const read = JSON.parse(await tool.handler({ action: "getItems", slug: "students" })) as { count: number };
    assert.equal(read.count, 1);
  });

  it("remote-view mutate refuses with read-only-collection before any policy check", async () => {
    writeSkill("students", { ...CSV_SCHEMA, views: [{ id: "cards", label: "Cards", file: "views/cards.html", target: "mobile", editableFields: ["name"] }] });
    const collection = await loadCollection("students", discoveryOpts());
    const deps = {
      readItem: async () => ({ student_id: "S-001" }),
      writeItem: async () => {
        throw new Error("must not be called");
      },
      deleteItem: async () => {
        throw new Error("must not be called");
      },
      enrichItems: async (_collection: unknown, items: unknown[]) => items,
      resolveThumbnail: async () => null,
    } as unknown as MutateRemoteViewDeps;
    assert.ok(collection);
    const mutate = createMutateRemoteView(deps);
    const result = await mutate(collection, "cards", { op: "update", id: "S-001", patch: { name: "x" } });
    assert.equal(result.kind, "read-only-collection");
  });
});

describe("query DSL (v2)", () => {
  it("CollectionQueryZ rejects unsafe aliases, empty queries, dangling orderBy, and scalar `in`", () => {
    assert.equal(CollectionQueryZ.safeParse({}).success, false); // neither groupBy nor aggregates
    assert.equal(CollectionQueryZ.safeParse({ aggregates: { "a; DROP": { op: "count" } } }).success, false);
    assert.equal(CollectionQueryZ.safeParse({ aggregates: { "total price": { op: "count" } } }).success, false);
    assert.equal(CollectionQueryZ.safeParse({ aggregates: { total: { op: "sum" } } }).success, false); // sum needs column
    assert.equal(CollectionQueryZ.safeParse({ groupBy: ["a"], orderBy: [{ field: "ghost" }] }).success, false);
    assert.equal(CollectionQueryZ.safeParse({ groupBy: ["a"], where: [{ field: "x", op: "in", value: "scalar" }] }).success, false);
    assert.equal(
      CollectionQueryZ.safeParse({ groupBy: ["Category"], aggregates: { n: { op: "count" } }, orderBy: [{ field: "n", dir: "desc" }] }).success,
      true,
    );
  });

  it("compileCsvQuery keeps values in params (never in SQL) and quotes hostile identifiers", () => {
    const parsed = CollectionQueryZ.parse({
      groupBy: ['evil"col'],
      aggregates: { n: { op: "count" } },
      where: [{ field: "name", op: "eq", value: "'; DROP TABLE x; --" }],
    });
    const { sql, params } = compileCsvQuery(parsed, "id");
    assert.ok(!sql.includes("DROP"), "value text must never reach the SQL string");
    assert.deepEqual(params, ["'; DROP TABLE x; --"]);
    assert.ok(sql.includes('"evil""col"'), "identifiers are double-quote escaped");
    assert.ok(sql.includes("LIMIT 1000"), "default result clamp applies");
  });

  it("aggregates over the WHOLE file — beyond the list row cap — with group-by / where / orderBy", async () => {
    writeSkill("students", CSV_SCHEMA);
    const rows = Array.from(
      { length: MAX_CSV_ROWS + 500 },
      (_unused, index) => `S-${index},Name${index},${index % 2 === 0 ? 10 : 20},${index % 2 === 0 ? "a" : "b"}`,
    );
    writeCsv("data/students.csv", `student_id,name,score,bucket\n${rows.join("\n")}\n`);
    const collection = await loadCollection("students", discoveryOpts());
    assert.ok(collection);
    const store = storeFor(collection, { workspaceRoot: workdir });
    assert.ok(store.query);

    const total = await store.query({ aggregates: { n: { op: "count" } } });
    assert.equal(total[0]?.n, MAX_CSV_ROWS + 500); // uncapped scan — list() would stop at MAX_CSV_ROWS

    const grouped = await store.query({
      groupBy: ["bucket"],
      aggregates: { n: { op: "count" }, avgScore: { op: "avg", column: "score" } },
      orderBy: [{ field: "bucket", dir: "asc" }],
    });
    assert.deepEqual(
      grouped.map((row) => [row.bucket, row.n, row.avgScore]),
      [
        ["a", 2750, 10],
        ["b", 2750, 20],
      ],
    );

    const filtered = await store.query({ aggregates: { s: { op: "sum", column: "score" } }, where: [{ field: "bucket", op: "eq", value: "b" }] });
    assert.equal(filtered[0]?.s, 2750 * 20);
  });

  it("manageCollection queryItems: works on dataSource, refuses file-backed, rejects a bad query", async () => {
    writeSkill("students", CSV_SCHEMA);
    writeCsv("data/students.csv", "student_id,name,score\nS-1,A,10\nS-2,B,30\n");
    writeSkill("plain", {
      title: "Plain",
      icon: "folder",
      dataPath: "data/plain/items",
      primaryKey: "id",
      fields: { id: { type: "string", label: "ID", primary: true } },
    });
    const tool = makeManageCollectionTool(discoveryOpts());

    const ok = JSON.parse(await tool.handler({ action: "queryItems", slug: "students", query: { aggregates: { total: { op: "sum", column: "score" } } } })) as {
      rows: Record<string, unknown>[];
    };
    assert.equal(ok.rows[0]?.total, 40);

    const refused = await tool.handler({ action: "queryItems", slug: "plain", query: { aggregates: { n: { op: "count" } } } });
    assert.match(refused, /file-backed/);

    const invalid = await tool.handler({ action: "queryItems", slug: "students", query: { aggregates: { "bad alias": { op: "count" } } } });
    assert.match(invalid, /rejected/);
  });
});
