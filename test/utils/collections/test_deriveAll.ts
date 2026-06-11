// Unit tests for the shared derived-field saturation loop
// (src/utils/collections/deriveAll.ts) — the one implementation the
// client rendering layer AND the server's manageCollection enrichment
// both call, so its convergence/cycle/ref semantics are pinned here.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { deriveAll, resolveRowRefs, type DerivableSchema } from "../../../src/utils/collections/deriveAll.js";

const field = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra });

describe("deriveAll — saturation across chained derived fields", () => {
  // total reads tax reads subtotal: declaration order is reversed on
  // purpose so convergence REQUIRES multiple passes.
  const schema: DerivableSchema = {
    fields: {
      total: field("derived", { formula: "subtotal + tax" }),
      tax: field("derived", { formula: "subtotal * taxRate" }),
      subtotal: field("derived", { formula: "sum(lineItems[].quantity * lineItems[].rate)" }),
      taxRate: field("number"),
      lineItems: field("table"),
    },
  };

  it("converges within field-count passes regardless of declaration order", () => {
    const enriched = deriveAll(
      schema,
      {
        taxRate: 0.1,
        lineItems: [
          { quantity: 10, rate: 100 },
          { quantity: 2, rate: 250 },
        ],
      },
      {},
    );
    assert.equal(enriched.subtotal, 1500);
    assert.equal(enriched.tax, 150);
    assert.equal(enriched.total, 1650);
  });

  it("does not mutate the base record", () => {
    const base = { taxRate: 0.1, lineItems: [{ quantity: 1, rate: 100 }] };
    deriveAll(schema, base, {});
    assert.deepEqual(base, { taxRate: 0.1, lineItems: [{ quantity: 1, rate: 100 }] });
  });

  it("leaves a failed formula absent instead of poisoning siblings", () => {
    // No taxRate: `tax` (and so `total`) can never evaluate, but
    // `subtotal` still does — a failure stays local to its field.
    const enriched = deriveAll(schema, { lineItems: [{ quantity: 1, rate: 100 }] }, {});
    assert.equal(enriched.subtotal, 100);
    assert.equal(enriched.tax, undefined);
    assert.equal(enriched.total, undefined);
  });
});

describe("deriveAll — persisted derived values are never trusted", () => {
  const schema: DerivableSchema = {
    fields: {
      ticker: field("ref", { to: "stock-quotes" }),
      shares: field("number"),
      value: field("derived", { formula: "shares * ticker.price" }),
    },
  };

  it("a stale stored value is stripped when the formula fails (dangling ref)", () => {
    // The record carries value: 999 (raw Write / legacy data); the
    // formula can't evaluate. The stale value must NOT survive as if
    // host-computed.
    const enriched = deriveAll(schema, { ticker: "ghost", shares: 10, value: 999 }, {});
    assert.equal(enriched.value, undefined);
  });

  it("a stale stored value is replaced when the formula succeeds", () => {
    const refRecords = { "stock-quotes": { aapl: { price: 200 } } };
    const enriched = deriveAll(schema, { ticker: "aapl", shares: 10, value: 999 }, refRecords);
    assert.equal(enriched.value, 2000);
  });
});

describe("deriveAll — cycles", () => {
  it("saturates without looping on a 2-cycle", () => {
    const schema: DerivableSchema = {
      fields: {
        a: field("derived", { formula: "b + 1" }),
        b: field("derived", { formula: "a + 1" }),
      },
    };
    // Bounded passes (= derived-field count); values climb once per pass
    // then the loop exits. The exact values don't matter — termination
    // and "no throw" do.
    const enriched = deriveAll(schema, {}, {});
    assert.ok(!("a" in enriched) || typeof enriched.a === "number");
  });
});

describe("deriveAll + resolveRowRefs — cross-collection deref", () => {
  const schema: DerivableSchema = {
    fields: {
      ticker: field("ref", { to: "stock-quotes" }),
      shares: field("number"),
      value: field("derived", { formula: "shares * ticker.price" }),
    },
  };
  const refRecords = { "stock-quotes": { aapl: { symbol: "aapl", price: 200 } } };

  it("evaluates shares * ticker.price through the ref cache", () => {
    const enriched = deriveAll(schema, { ticker: "aapl", shares: 10 }, refRecords);
    assert.equal(enriched.value, 2000);
  });

  it("dangling ref slug yields no derived value", () => {
    const enriched = deriveAll(schema, { ticker: "msft", shares: 10 }, refRecords);
    assert.equal(enriched.value, undefined);
  });

  it("missing target collection yields no derived value", () => {
    const enriched = deriveAll(schema, { ticker: "aapl", shares: 10 }, {});
    assert.equal(enriched.value, undefined);
  });

  it("resolveRowRefs keys by LOCAL field name and nulls non-string slugs", () => {
    const refs = resolveRowRefs(schema, { ticker: "aapl", shares: 10 }, refRecords);
    assert.deepEqual(refs, { ticker: { symbol: "aapl", price: 200 } });
    assert.deepEqual(resolveRowRefs(schema, { ticker: 42 }, refRecords), { ticker: null });
  });
});
