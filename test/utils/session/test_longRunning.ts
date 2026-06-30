import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isLongRunning, sessionDurationMs, LONG_RUNNING_THRESHOLD_MS } from "../../../src/utils/session/longRunning.js";

const START = "2026-01-01T00:00:00.000Z";
const startMs = Date.parse(START);
const isoAt = (offsetMs: number) => new Date(startMs + offsetMs).toISOString();

describe("sessionDurationMs", () => {
  it("returns the span between startedAt and updatedAt", () => {
    assert.equal(sessionDurationMs({ startedAt: START, updatedAt: isoAt(3600_000) }), 3600_000);
  });

  it("clamps a negative span (updatedAt before startedAt) to 0", () => {
    assert.equal(sessionDurationMs({ startedAt: START, updatedAt: isoAt(-5000) }), 0);
  });

  it("returns 0 for unparseable timestamps", () => {
    assert.equal(sessionDurationMs({ startedAt: "not-a-date", updatedAt: START }), 0);
    assert.equal(sessionDurationMs({ startedAt: START, updatedAt: "" }), 0);
  });
});

describe("isLongRunning", () => {
  it("is false for a short, one-shot session", () => {
    assert.equal(isLongRunning({ startedAt: START, updatedAt: isoAt(3600_000) }), false);
  });

  it("is true exactly at the 24h threshold (inclusive)", () => {
    assert.equal(isLongRunning({ startedAt: START, updatedAt: isoAt(LONG_RUNNING_THRESHOLD_MS) }), true);
  });

  it("is false just under the threshold", () => {
    assert.equal(isLongRunning({ startedAt: START, updatedAt: isoAt(LONG_RUNNING_THRESHOLD_MS - 1000) }), false);
  });

  it("is true for a multi-day conversation", () => {
    assert.equal(isLongRunning({ startedAt: START, updatedAt: isoAt(LONG_RUNNING_THRESHOLD_MS * 5) }), true);
  });

  it("is false when timestamps are unparseable", () => {
    assert.equal(isLongRunning({ startedAt: "x", updatedAt: "y" }), false);
  });
});
