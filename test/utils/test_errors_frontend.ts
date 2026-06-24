// Unit test for `src/utils/errors.ts::toError`. Mirrors the
// server-side `test_errors.ts` for `errorMessage`. `toError` is the
// Error-coercion side: take an unknown caught value and return an
// Error object suitable for downstream consumers that want
// `.message` / `.stack` (error boundaries, Promise reject paths).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toError } from "../../src/utils/errors.ts";

describe("toError", () => {
  it("returns the same Error instance unchanged", () => {
    const original = new Error("boom");
    assert.equal(toError(original), original);
  });

  it("preserves a subclass instance", () => {
    class CustomError extends Error {}
    const original = new CustomError("specific");
    const out = toError(original);
    assert.equal(out, original);
    assert.ok(out instanceof CustomError);
  });

  it("wraps a string in a new Error", () => {
    const out = toError("oops");
    assert.ok(out instanceof Error);
    assert.equal(out.message, "oops");
  });

  it("wraps a number using errorMessage's string coercion", () => {
    assert.equal(toError(42).message, "42");
  });

  it("wraps null / undefined using their string coercion", () => {
    assert.equal(toError(null).message, "null");
    assert.equal(toError(undefined).message, "undefined");
  });

  it("uses the gRPC-style .details field when present", () => {
    assert.equal(toError({ code: 3, details: "voice needs model" }).message, "voice needs model");
  });

  it("uses .message from a plain object", () => {
    assert.equal(toError({ message: "boom" }).message, "boom");
  });

  it("uses the fallback string for a non-Error when provided", () => {
    // The favicon Image.onerror case — the onerror callback hands you
    // an Event, not the underlying load failure. String(Event) is
    // noise; pass a descriptive fallback so the rejection carries
    // an actionable message.
    const fakeEvent = new Event("error");
    assert.equal(toError(fakeEvent, "favicon logo failed to load").message, "favicon logo failed to load");
  });

  it("does NOT use the fallback when the value is already an Error", () => {
    // An Error's own .message is more specific than any fallback the
    // caller could supply, so preserve it.
    const original = new Error("real cause");
    assert.equal(toError(original, "fallback").message, "real cause");
  });
});
