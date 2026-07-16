// Unit tests for the `google` tool arg schemas — validation only, no
// network and no engine calls.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { GoogleArgs, isIsoDateTimeWithOffset } from "../src/args";

describe("isIsoDateTimeWithOffset", () => {
  const accepted = ["2026-07-17T09:00:00+09:00", "2026-07-17T09:00:00Z", "2026-07-17T09:00:00.000Z", "2026-07-17T23:59:59.5-05:00"];
  for (const value of accepted) {
    it(`accepts ${value}`, () => {
      assert.equal(isIsoDateTimeWithOffset(value), true);
    });
  }

  const rejected = ["2026-07-17", "2026-07-17T09:00:00", "not-a-date", "2026-13-01T09:00:00Z", "2026-07-17T09:00Z", ""];
  for (const value of rejected) {
    it(`rejects ${JSON.stringify(value)}`, () => {
      assert.equal(isIsoDateTimeWithOffset(value), false);
    });
  }
});

describe("GoogleArgs", () => {
  it("parses a status request", () => {
    assert.deepEqual(GoogleArgs.parse({ kind: "status" }), { kind: "status" });
  });

  it("parses calendarListEvents with defaults omitted", () => {
    assert.deepEqual(GoogleArgs.parse({ kind: "calendarListEvents" }), { kind: "calendarListEvents" });
  });

  it("rejects an out-of-range maxResults", () => {
    assert.throws(() => GoogleArgs.parse({ kind: "calendarListEvents", maxResults: 500 }));
    assert.throws(() => GoogleArgs.parse({ kind: "calendarListEvents", maxResults: 0 }));
  });

  it("rejects a non-integer maxResults", () => {
    assert.throws(() => GoogleArgs.parse({ kind: "calendarListEvents", maxResults: 2.5 }));
  });

  it("parses a full calendarCreateEvent", () => {
    const args = GoogleArgs.parse({
      kind: "calendarCreateEvent",
      summary: "Standup",
      start: "2026-07-17T09:00:00+09:00",
      end: "2026-07-17T09:15:00+09:00",
      description: "daily",
    });
    assert.equal(args.kind, "calendarCreateEvent");
  });

  it("rejects calendarCreateEvent with a date-only start", () => {
    assert.throws(() => GoogleArgs.parse({ kind: "calendarCreateEvent", summary: "x", start: "2026-07-17", end: "2026-07-17T10:00:00+09:00" }));
  });

  it("rejects calendarCreateEvent with an empty summary", () => {
    assert.throws(() => GoogleArgs.parse({ kind: "calendarCreateEvent", summary: "", start: "2026-07-17T09:00:00Z", end: "2026-07-17T10:00:00Z" }));
  });

  it("rejects an unknown kind", () => {
    assert.throws(() => GoogleArgs.parse({ kind: "gmailSend" }));
  });
});
