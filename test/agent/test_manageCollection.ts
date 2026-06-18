import "../../server/workspace/collections/configure.js"; // configure @mulmoclaude/collection-plugin host binding for tests
// `manageCollection` MCP tool: getItems returns computed-enriched
// records with ids/fields selection and the unselective-size refusal;
// putItems gates every row on schema validation (and computed-key
// rejection) BEFORE writing, with per-row accept/reject results.
// Exercised against a real tmpdir workspace via the factory's injected
// DiscoveryOptions — no mocking of the collections layer, so the test
// pins the same code paths production runs.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { makeManageCollectionTool, MAX_UNSELECTIVE_ITEMS } from "../../server/agent/mcp-tools/manageCollection.js";
import { mcpTools } from "../../server/agent/mcp-tools/index.js";

let workdir: string;
let emptyUserDir: string;
let tool: ReturnType<typeof makeManageCollectionTool>;

const quotesSchema = {
  title: "Stock Quotes",
  icon: "trending_up",
  dataPath: "data/stock-quotes/items",
  primaryKey: "symbol",
  fields: {
    symbol: { type: "string", label: "Symbol", primary: true, required: true },
    price: { type: "number", label: "Price" },
  },
};

const portfolioSchema = {
  title: "Portfolio",
  icon: "work",
  dataPath: "data/portfolio/items",
  primaryKey: "id",
  fields: {
    id: { type: "string", label: "ID", primary: true, required: true },
    name: { type: "string", label: "Name", required: true },
    ticker: { type: "ref", label: "Ticker", to: "stock-quotes" },
    shares: { type: "number", label: "Shares" },
    value: { type: "derived", label: "Value", formula: "shares * ticker.price" },
    status: { type: "enum", label: "Status", values: ["open", "closed"] },
    closed: { type: "toggle", label: "Closed", field: "status", onValue: "closed", offValue: "open" },
    owner: { type: "embed", label: "Owner", to: "profile", id: "me" },
  },
};

const profileSchema = {
  title: "Profile",
  icon: "person",
  dataPath: "data/profile/items",
  primaryKey: "id",
  singleton: "me",
  fields: {
    id: { type: "string", label: "ID", primary: true, required: true },
    name: { type: "string", label: "Name" },
  },
};

beforeEach(() => {
  workdir = mkdtempSync(path.join(tmpdir(), "manage-collection-"));
  emptyUserDir = mkdtempSync(path.join(tmpdir(), "manage-collection-user-"));
  tool = makeManageCollectionTool({ workspaceRoot: workdir, userSkillsDir: emptyUserDir });
  writeSkill("stock-quotes", quotesSchema);
  writeSkill("portfolio", portfolioSchema);
  writeSkill("profile", profileSchema);
  writeRecord("data/stock-quotes/items", "aapl", { symbol: "aapl", price: 200 });
  writeRecord("data/profile/items", "me", { id: "me", name: "Satoshi" });
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
  rmSync(emptyUserDir, { recursive: true, force: true });
});

function writeSkill(slug: string, schema: object): void {
  const dir = path.join(workdir, ".claude/skills", slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${slug}\ndescription: test fixture\n---\nbody\n`);
  writeFileSync(path.join(dir, "schema.json"), JSON.stringify(schema));
}

function writeRecord(dataPath: string, itemId: string, record: object): void {
  const dir = path.join(workdir, dataPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${itemId}.json`), JSON.stringify(record));
}

const run = (args: Record<string, unknown>) => tool.handler(args);
const runJson = async (args: Record<string, unknown>) => JSON.parse(await run(args)) as Record<string, unknown>;

describe("manageCollection — argument validation", () => {
  it("requires slug and a known action", async () => {
    assert.match(await run({ action: "getItems" }), /`slug` is required/);
    assert.match(await run({ action: "destroy", slug: "portfolio" }), /`action` must be/);
  });

  it("reports an unknown collection", async () => {
    assert.match(await run({ action: "getItems", slug: "nope" }), /unknown collection 'nope'/);
  });

  it("rejects malformed ids / fields / items / mode", async () => {
    assert.match(await run({ action: "getItems", slug: "portfolio", ids: [42] }), /`ids` must be an array/);
    assert.match(await run({ action: "getItems", slug: "portfolio", fields: "name" }), /`fields` must be an array/);
    assert.match(await run({ action: "putItems", slug: "portfolio" }), /`items` is required/);
    assert.match(await run({ action: "putItems", slug: "portfolio", items: [[1]] }), /`items` is required/);
    assert.match(await run({ action: "putItems", slug: "portfolio", items: [{ id: "a" }], mode: "replace" }), /`mode` must be/);
  });

  it("is registered as an alwaysActive MCP tool", () => {
    const registered = mcpTools.find((entry) => entry.definition.name === "manageCollection");
    assert.ok(registered, "manageCollection must be in the mcpTools array");
    assert.equal(registered.alwaysActive, true);
  });
});

describe("manageCollection — getItems", () => {
  beforeEach(() => {
    writeRecord("data/portfolio/items", "h1", { id: "h1", name: "Apple", ticker: "aapl", shares: 10, status: "open" });
    writeRecord("data/portfolio/items", "h2", { id: "h2", name: "Cash", status: "closed" });
  });

  it("returns records enriched with derived + toggle values", async () => {
    const result = await runJson({ action: "getItems", slug: "portfolio" });
    assert.equal(result.count, 2);
    const items = result.items as Record<string, unknown>[];
    const apple = items.find((item) => item.id === "h1");
    const cash = items.find((item) => item.id === "h2");
    assert.equal(apple?.value, 2000); // 10 * 200, host-computed
    assert.equal(apple?.closed, false);
    assert.equal(cash?.closed, true);
  });

  it("selects by ids and reports missing ones", async () => {
    const result = await runJson({ action: "getItems", slug: "portfolio", ids: ["h1", "ghost"] });
    assert.equal(result.count, 1);
    assert.deepEqual(result.missing, ["ghost"]);
  });

  it("resolves embed fields to the target record, null when missing", async () => {
    const withProfile = await runJson({ action: "getItems", slug: "portfolio", ids: ["h1"] });
    const [item] = withProfile.items as Record<string, unknown>[];
    assert.deepEqual(item?.owner, { id: "me", name: "Satoshi" });
    rmSync(path.join(workdir, "data/profile/items/me.json"), { force: true });
    const withoutProfile = await runJson({ action: "getItems", slug: "portfolio", ids: ["h1"] });
    const [bare] = withoutProfile.items as Record<string, unknown>[];
    assert.equal(bare?.owner, null);
  });

  it("a stale stored derived value never reaches the result", async () => {
    writeRecord("data/portfolio/items", "h9", { id: "h9", name: "Forged", ticker: "ghost", shares: 10, value: 999, status: "open" });
    const result = await runJson({ action: "getItems", slug: "portfolio", ids: ["h9"] });
    const [item] = result.items as Record<string, unknown>[];
    assert.equal(item?.value, undefined); // formula fails (dangling ref) → absent, not 999
  });

  it("projects fields, always keeping the primary key", async () => {
    const result = await runJson({ action: "getItems", slug: "portfolio", ids: ["h1"], fields: ["value"] });
    const [item] = result.items as Record<string, unknown>[];
    assert.deepEqual(item, { id: "h1", value: 2000 });
  });

  it("appends a defanged warning for malformed record files", async () => {
    writeFileSync(path.join(workdir, "data/portfolio/items/bad.json"), '{ "id": "bad", broken');
    const result = await runJson({ action: "getItems", slug: "portfolio" });
    assert.match(String(result.warning), /bad\.json/);
    assert.match(String(result.warning), /1 record file/);
  });

  it("skips the warning scan on a selective read that found everything", async () => {
    writeFileSync(path.join(workdir, "data/portfolio/items/bad.json"), '{ "id": "bad", broken');
    const found = await runJson({ action: "getItems", slug: "portfolio", ids: ["h1"] });
    assert.equal(found.warning, undefined); // all requested ids present → no full scan
    // A requested id that comes back missing IS explained by the scan.
    const missed = await runJson({ action: "getItems", slug: "portfolio", ids: ["bad"] });
    assert.deepEqual(missed.missing, ["bad"]);
    assert.match(String(missed.warning), /bad\.json/);
  });

  it("refuses an unselective read over the limit, lifted by fields", async () => {
    for (let i = 0; i < MAX_UNSELECTIVE_ITEMS + 1; i++) {
      writeRecord("data/portfolio/items", `r${i}`, { id: `r${i}`, name: `R${i}` });
    }
    assert.match(await run({ action: "getItems", slug: "portfolio" }), /over the unselective limit/);
    const projected = await runJson({ action: "getItems", slug: "portfolio", fields: ["name"] });
    assert.equal(projected.count, MAX_UNSELECTIVE_ITEMS + 3);
  });
});

describe("manageCollection — putItems", () => {
  const record = (itemId: string, extra: Record<string, unknown> = {}) => ({ id: itemId, name: `Name ${itemId}`, status: "open", ...extra });
  const stored = (itemId: string) => JSON.parse(readFileSync(path.join(workdir, `data/portfolio/items/${itemId}.json`), "utf-8")) as Record<string, unknown>;

  it("writes valid rows and rejects invalid rows independently", async () => {
    const result = await runJson({
      action: "putItems",
      slug: "portfolio",
      items: [record("good"), { id: "noname", status: "open" }, record("badenum", { status: "nope" })],
    });
    assert.deepEqual(result.written, ["good"]);
    const rejected = result.rejected as { id: string; problem: string }[];
    assert.equal(rejected.length, 2);
    assert.match(rejected.find((row) => row.id === "noname")?.problem ?? "", /missing required field 'name'/);
    assert.match(rejected.find((row) => row.id === "badenum")?.problem ?? "", /not one of/);
    assert.deepEqual(stored("good"), record("good"));
    assert.ok(!existsSync(path.join(workdir, "data/portfolio/items/noname.json")), "rejected row must not be written");
  });

  it("rejects a row with no primaryKey value", async () => {
    const result = await runJson({ action: "putItems", slug: "portfolio", items: [{ name: "No Id", status: "open" }] });
    const [rejectedRow] = result.rejected as { id: string; problem: string }[];
    assert.match(rejectedRow?.problem ?? "", /has no 'id' value/);
  });

  it("rejects computed keys with an actionable pointer", async () => {
    const result = await runJson({
      action: "putItems",
      slug: "portfolio",
      items: [record("a", { value: 999 }), record("b", { closed: true })],
    });
    const rejected = result.rejected as { id: string; problem: string }[];
    assert.match(rejected.find((row) => row.id === "a")?.problem ?? "", /'value' is derived/);
    assert.match(rejected.find((row) => row.id === "b")?.problem ?? "", /write the enum field 'status' instead/);
    assert.deepEqual(result.written, []);
    const embed = await runJson({ action: "putItems", slug: "portfolio", items: [record("c", { owner: { id: "me" } })] });
    assert.match((embed.rejected as { problem: string }[])[0]?.problem ?? "", /'owner' is an embed/);
  });

  it("rejects path-shaped ids before any write", async () => {
    const result = await runJson({ action: "putItems", slug: "portfolio", items: [record("../evil")] });
    const [rejectedRow] = result.rejected as { id: string; problem: string }[];
    assert.match(rejectedRow?.problem ?? "", /not a valid record id/);
  });

  it('mode "create" refuses an existing id; default upsert overwrites', async () => {
    writeRecord("data/portfolio/items", "h1", record("h1"));
    const created = await runJson({ action: "putItems", slug: "portfolio", items: [record("h1")], mode: "create" });
    assert.match((created.rejected as { problem: string }[])[0]?.problem ?? "", /already exists/);
    const upserted = await runJson({ action: "putItems", slug: "portfolio", items: [record("h1", { shares: 5 })] });
    assert.deepEqual(upserted.written, ["h1"]);
    assert.equal(stored("h1").shares, 5);
  });

  it('mode "merge" updates only the carried fields, keeping the rest', async () => {
    writeRecord("data/portfolio/items", "h1", record("h1", { ticker: "aapl", shares: 10, notes: "keep me" }));
    const merged = await runJson({ action: "putItems", slug: "portfolio", items: [{ id: "h1", status: "closed" }], mode: "merge" });
    assert.deepEqual(merged.written, ["h1"]);
    // The partial row changed status; everything it omitted survives.
    assert.deepEqual(stored("h1"), record("h1", { ticker: "aapl", shares: 10, notes: "keep me", status: "closed" }));
  });

  it("the same partial row under default upsert documents the hazard merge prevents", async () => {
    // A partial upsert passes validation only when every REQUIRED field
    // is carried — here it isn't, so validation already rejects it. With
    // name carried it would write and erase the optionals; merge is the
    // safe path for partial updates either way.
    writeRecord("data/portfolio/items", "h1", record("h1", { notes: "keep me" }));
    const partial = await runJson({ action: "putItems", slug: "portfolio", items: [{ id: "h1", status: "closed" }] });
    assert.match((partial.rejected as { problem: string }[])[0]?.problem ?? "", /missing required field 'name'/);
    assert.equal(stored("h1").notes, "keep me");
  });

  it('mode "merge" rejects an unknown id instead of creating a partial record', async () => {
    const result = await runJson({ action: "putItems", slug: "portfolio", items: [{ id: "ghost", status: "open" }], mode: "merge" });
    const [rejectedRow] = result.rejected as { id: string; problem: string }[];
    assert.match(rejectedRow?.problem ?? "", /not found .* use "upsert" or "create"/);
    assert.ok(!existsSync(path.join(workdir, "data/portfolio/items/ghost.json")));
  });

  it('mode "merge" heals a stale computed key in the stored record', async () => {
    // Raw-written/legacy record carrying a forged host-computed value:
    // a merge must not re-write it.
    writeRecord("data/portfolio/items", "h1", record("h1", { value: 999, notes: "keep me" }));
    const merged = await runJson({ action: "putItems", slug: "portfolio", items: [{ id: "h1", status: "closed" }], mode: "merge" });
    assert.deepEqual(merged.written, ["h1"]);
    const healed = stored("h1");
    assert.ok(!("value" in healed), "stale derived key must be stripped on merge");
    assert.equal(healed.notes, "keep me");
    assert.equal(healed.status, "closed");
  });

  it('mode "merge" still validates the merged result and rejects computed keys', async () => {
    writeRecord("data/portfolio/items", "h1", record("h1", { notes: "keep me" }));
    const badEnum = await runJson({ action: "putItems", slug: "portfolio", items: [{ id: "h1", status: "nope" }], mode: "merge" });
    assert.match((badEnum.rejected as { problem: string }[])[0]?.problem ?? "", /not one of/);
    assert.equal(stored("h1").status, "open"); // untouched
    const computed = await runJson({ action: "putItems", slug: "portfolio", items: [{ id: "h1", value: 1 }], mode: "merge" });
    assert.match((computed.rejected as { problem: string }[])[0]?.problem ?? "", /'value' is derived/);
  });
});
