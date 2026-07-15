import "../../../server/workspace/collections/configure.js"; // configure @mulmoclaude/core/collection host binding for tests
// Server-side computed-field enrichment (collections/derive.ts):
// derived formulas evaluated through the SHARED deriveAll loop with
// ref targets loaded from disk, toggles projected off their enum, and
// embeds resolved to the fixed target record. Exercised against real
// on-disk collections (workspaceRoot + userSkillsDir overrides — same
// isolation pattern as test_discovery.ts).

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ref } from "vue";

import { enrichItems, loadCollection, toDetail } from "@mulmoclaude/core/collection/server";
import { useCollectionRendering } from "@mulmoclaude/collection-plugin/vue";
import { deriveAll } from "@mulmoclaude/core/collection";
import type { CollectionDetail, FieldSpec } from "../../../src/components/collectionTypes.js";

let workdir: string;
let emptyUserDir: string;

beforeEach(() => {
  workdir = mkdtempSync(path.join(tmpdir(), "collections-derive-"));
  emptyUserDir = mkdtempSync(path.join(tmpdir(), "collections-derive-user-"));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
  rmSync(emptyUserDir, { recursive: true, force: true });
});

const opts = () => ({ workspaceRoot: workdir, userSkillsDir: emptyUserDir });

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

const quotesSchema = {
  title: "Stock Quotes",
  icon: "trending_up",
  dataPath: "data/stock-quotes/items",
  primaryKey: "symbol",
  fields: {
    symbol: { type: "string", label: "Symbol", primary: true, required: true },
    price: { type: "number", label: "Price" },
    doubled: { type: "derived", label: "Doubled", formula: "price * 2" },
  },
};

const portfolioSchema = {
  title: "Portfolio",
  icon: "work",
  dataPath: "data/portfolio/items",
  primaryKey: "id",
  fields: {
    id: { type: "string", label: "ID", primary: true, required: true },
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

async function enrichPortfolio(items: Record<string, unknown>[]) {
  const collection = await loadCollection("portfolio", opts());
  assert.ok(collection, "portfolio collection must load");
  return enrichItems(collection, items, opts());
}

describe("enrichItems — derived across refs", () => {
  beforeEach(() => {
    writeSkill("stock-quotes", quotesSchema);
    writeSkill("portfolio", portfolioSchema);
    writeSkill("profile", profileSchema);
    writeRecord("data/stock-quotes/items", "aapl", { symbol: "aapl", price: 200 });
    writeRecord("data/profile/items", "me", { id: "me", name: "Satoshi" });
  });

  it("evaluates shares * ticker.price from the on-disk target", async () => {
    const [enriched] = await enrichPortfolio([{ id: "h1", ticker: "aapl", shares: 10, status: "open" }]);
    assert.equal(enriched?.value, 2000);
  });

  it("ref targets are themselves derived first (mirrors the client's buildRefRecordMap)", async () => {
    writeSkill("portfolio", {
      ...portfolioSchema,
      fields: { ...portfolioSchema.fields, value: { type: "derived", label: "Value", formula: "shares * ticker.doubled" } },
    });
    const [enriched] = await enrichPortfolio([{ id: "h1", ticker: "aapl", shares: 10 }]);
    assert.equal(enriched?.value, 4000); // 10 * (200 * 2)
  });

  it("dangling ref slug leaves the derived field absent", async () => {
    const [enriched] = await enrichPortfolio([{ id: "h1", ticker: "msft", shares: 10 }]);
    assert.equal(enriched?.value, undefined);
  });

  it("a stale stored derived value never survives enrichment", async () => {
    // Raw-written/legacy record carrying value: 999 with a formula that
    // can't evaluate (dangling ticker): the stale value must come back
    // absent, not echoed as host-computed truth.
    const [enriched] = await enrichPortfolio([{ id: "h1", ticker: "ghost", shares: 10, value: 999 }]);
    assert.equal(enriched?.value, undefined);
  });

  it("missing target collection leaves the derived field absent", async () => {
    rmSync(path.join(workdir, ".claude/skills/stock-quotes"), { recursive: true, force: true });
    const [enriched] = await enrichPortfolio([{ id: "h1", ticker: "aapl", shares: 10 }]);
    assert.equal(enriched?.value, undefined);
  });

  it("projects toggle fields off their enum", async () => {
    const enriched = await enrichPortfolio([{ id: "h1", status: "closed" }, { id: "h2", status: "open" }, { id: "h3" }]);
    assert.equal(enriched[0]?.closed, true);
    assert.equal(enriched[1]?.closed, false);
    assert.equal(enriched[2]?.closed, false);
  });

  it("resolves embed fields to the fixed target record, null when missing", async () => {
    const [withProfile] = await enrichPortfolio([{ id: "h1" }]);
    assert.deepEqual(withProfile?.owner, { id: "me", name: "Satoshi" });
    rmSync(path.join(workdir, "data/profile/items/me.json"), { force: true });
    const [withoutProfile] = await enrichPortfolio([{ id: "h1" }]);
    assert.equal(withoutProfile?.owner, null);
  });

  it("resolves a per-record embed (`idField`) to a different target per row", async () => {
    // Profile is non-singleton here (multiple issuers), and the embed
    // points at whichever one the row's `ownerId` names.
    writeSkill("profile", { ...profileSchema, singleton: undefined });
    writeSkill("portfolio", {
      ...portfolioSchema,
      fields: {
        ...portfolioSchema.fields,
        ownerId: { type: "ref", label: "Owner", to: "profile" },
        owner: { type: "embed", label: "Owner", to: "profile", idField: "ownerId" },
      },
    });
    writeRecord("data/profile/items", "acme", { id: "acme", name: "Acme LLC" });
    const enriched = await enrichPortfolio([
      { id: "h1", ownerId: "me" },
      { id: "h2", ownerId: "acme" },
      { id: "h3" }, // no ownerId → no embed
    ]);
    assert.deepEqual(enriched[0]?.owner, { id: "me", name: "Satoshi" });
    assert.deepEqual(enriched[1]?.owner, { id: "acme", name: "Acme LLC" });
    assert.equal(enriched[2]?.owner, null);
  });

  it("does not mutate the input records", async () => {
    const input = { id: "h1", ticker: "aapl", shares: 10 };
    await enrichPortfolio([input]);
    assert.deepEqual(input, { id: "h1", ticker: "aapl", shares: 10 });
  });

  it("resolves backlinks to the source rows pointing at the record, projected to primaryKey + display", async () => {
    writeSkill("stock-quotes", {
      ...quotesSchema,
      fields: {
        ...quotesSchema.fields,
        holders: { type: "backlinks", label: "Holders", from: "portfolio", via: "ticker", display: ["shares", "value"] },
      },
    });
    // A SELF-CONTAINED derived source column (no cross-collection deref)
    // evaluates in the backlink rows — the same rule as ref-target
    // derivation, which also derives each record against itself alone.
    writeSkill("portfolio", {
      ...portfolioSchema,
      fields: { ...portfolioSchema.fields, value: { type: "derived", label: "Value", formula: "shares * 2" } },
    });
    writeRecord("data/portfolio/items", "h1", { id: "h1", ticker: "aapl", shares: 10, status: "open" });
    writeRecord("data/portfolio/items", "h2", { id: "h2", ticker: "aapl", shares: 5, status: "closed" });
    writeRecord("data/portfolio/items", "h3", { id: "h3", ticker: "msft", shares: 3, status: "open" });
    const collection = await loadCollection("stock-quotes", opts());
    assert.ok(collection);
    const [enriched] = await enrichItems(collection, [{ symbol: "aapl", price: 200 }], opts());
    // h3 points elsewhere; rows carry the source primaryKey + display
    // columns only, with the derived source column computed.
    assert.deepEqual(enriched?.holders, [
      { id: "h1", shares: 10, value: 20 },
      { id: "h2", shares: 5, value: 10 },
    ]);
  });

  it("a backlink display column that derefs ANOTHER collection stays absent (ref-target derivation rule)", async () => {
    writeSkill("stock-quotes", {
      ...quotesSchema,
      fields: {
        ...quotesSchema.fields,
        holders: { type: "backlinks", label: "Holders", from: "portfolio", via: "ticker", display: ["shares", "value"] },
      },
    });
    // portfolioSchema's `value` is `shares * ticker.price` — a cross-
    // collection deref. Source records derive against themselves alone
    // (like ref targets / the client's buildRefRecordMap), so it can't
    // evaluate here and the key is simply absent (em-dash in the UI).
    writeRecord("data/portfolio/items", "h1", { id: "h1", ticker: "aapl", shares: 10, status: "open" });
    const collection = await loadCollection("stock-quotes", opts());
    assert.ok(collection);
    const [enriched] = await enrichItems(collection, [{ symbol: "aapl", price: 200 }], opts());
    assert.deepEqual(enriched?.holders, [{ id: "h1", shares: 10 }]);
  });

  it("backlinks filter narrows rows; a missing source collection fails soft to []", async () => {
    writeSkill("stock-quotes", {
      ...quotesSchema,
      fields: {
        ...quotesSchema.fields,
        openHolders: {
          type: "backlinks",
          label: "Open holders",
          from: "portfolio",
          via: "ticker",
          display: ["shares"],
          filter: { field: "status", in: ["open"] },
        },
        ghosts: { type: "backlinks", label: "Ghosts", from: "no-such-collection", via: "ticker", display: ["x"] },
      },
    });
    writeRecord("data/portfolio/items", "h1", { id: "h1", ticker: "aapl", shares: 10, status: "open" });
    writeRecord("data/portfolio/items", "h2", { id: "h2", ticker: "aapl", shares: 5, status: "closed" });
    const collection = await loadCollection("stock-quotes", opts());
    assert.ok(collection);
    const [enriched] = await enrichItems(collection, [{ symbol: "aapl", price: 200 }], opts());
    assert.deepEqual(enriched?.openHolders, [{ id: "h1", shares: 10 }]);
    assert.deepEqual(enriched?.ghosts, []);
  });

  it("matches the client rendering path exactly (determinism cross-check)", async () => {
    const collection = await loadCollection("portfolio", opts());
    assert.ok(collection);
    const item = { id: "h1", ticker: "aapl", shares: 10 };
    const [server] = await enrichItems(collection, [item], opts());

    // Client path: the composable with its ref cache primed the way
    // `loadLinkedCollections` would prime it from the detail endpoint.
    const detail = toDetail(collection) as unknown as CollectionDetail;
    const rendering = useCollectionRendering(ref<CollectionDetail | null>(detail), ref("en"));
    rendering.refRecordCache.value = { "stock-quotes": { aapl: { symbol: "aapl", price: 200 } } };
    const valueField = detail.schema.fields.value as FieldSpec;
    const clientValue = rendering.evaluateDerivedAgainstItem(valueField, "value", item);

    assert.equal(server?.value, 2000);
    assert.equal(clientValue, server?.value);
    // Stronger than value equality: both sides hold the SAME function.
    assert.equal(rendering.deriveAll, deriveAll);
  });

  it("backlinks: the client view-model agrees with the server rows (determinism cross-check)", async () => {
    const holdersField = { type: "backlinks", label: "Holders", from: "portfolio", via: "ticker", display: ["shares", "value"] };
    writeSkill("stock-quotes", { ...quotesSchema, fields: { ...quotesSchema.fields, holders: holdersField } });
    writeSkill("portfolio", {
      ...portfolioSchema,
      fields: { ...portfolioSchema.fields, value: { type: "derived", label: "Value", formula: "shares * 2" } },
    });
    writeRecord("data/portfolio/items", "h1", { id: "h1", ticker: "aapl", shares: 10, status: "open" });
    const collection = await loadCollection("stock-quotes", opts());
    assert.ok(collection);
    const [server] = await enrichItems(collection, [{ symbol: "aapl", price: 200 }], opts());

    // Client path: embedCache primed the way `loadLinkedCollections` would
    // prime it from the portfolio detail endpoint (raw stored items).
    const portfolio = await loadCollection("portfolio", opts());
    assert.ok(portfolio);
    const detail = toDetail(collection) as unknown as CollectionDetail;
    const rendering = useCollectionRendering(ref<CollectionDetail | null>(detail), ref("en"));
    rendering.embedCache.value = {
      portfolio: {
        schema: portfolio.schema as unknown as CollectionDetail["schema"],
        items: [{ id: "h1", ticker: "aapl", shares: 10, status: "open" }],
      },
    };
    const views = rendering.backlinksViewsFor({ symbol: "aapl", price: 200 });
    assert.equal(views.holders?.found, true);
    assert.deepEqual(
      views.holders?.columns.map((column) => column.label),
      ["Shares", "Value"],
    );
    // Same row set, same values — the derived `value` column agrees with
    // the server projection (both sides derive the SOURCE records the
    // same way: against themselves alone).
    assert.deepEqual(views.holders?.rows, [{ id: "h1", cells: ["10", "20"] }]);
    assert.deepEqual(server?.holders, [{ id: "h1", shares: 10, value: 20 }]);
  });
});
