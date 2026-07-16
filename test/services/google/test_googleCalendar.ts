// Unit tests for the Calendar REST mapping helpers — pure functions only, no
// network. The fetch path itself is covered by fetchWithTimeout's own tests.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { calendarApiError, toEventSummary } from "@mulmoclaude/core/google";

describe("toEventSummary", () => {
  it("maps a timed event (dateTime)", () => {
    const summary = toEventSummary({
      id: "ev1",
      summary: "Standup",
      status: "confirmed",
      htmlLink: "https://calendar.google.com/event?eid=ev1",
      start: { dateTime: "2026-07-17T09:00:00+09:00" },
      end: { dateTime: "2026-07-17T09:15:00+09:00" },
    });
    assert.deepEqual(summary, {
      id: "ev1",
      summary: "Standup",
      start: "2026-07-17T09:00:00+09:00",
      end: "2026-07-17T09:15:00+09:00",
      htmlLink: "https://calendar.google.com/event?eid=ev1",
      status: "confirmed",
    });
  });

  it("maps an all-day event (date)", () => {
    const summary = toEventSummary({ start: { date: "2026-07-17" }, end: { date: "2026-07-18" } });
    assert.equal(summary.start, "2026-07-17");
    assert.equal(summary.end, "2026-07-18");
  });

  it("prefers dateTime over date when both are present", () => {
    const summary = toEventSummary({ start: { dateTime: "2026-07-17T09:00:00Z", date: "2026-07-17" } });
    assert.equal(summary.start, "2026-07-17T09:00:00Z");
  });

  it("fills empty strings for missing fields", () => {
    assert.deepEqual(toEventSummary({}), { id: "", summary: "", start: "", end: "", htmlLink: "", status: "" });
  });

  it("tolerates a non-object payload", () => {
    assert.deepEqual(toEventSummary(null), { id: "", summary: "", start: "", end: "", htmlLink: "", status: "" });
  });

  it("ignores non-string field values", () => {
    const summary = toEventSummary({ id: 42, summary: ["x"], start: "not-an-object" });
    assert.deepEqual(summary, { id: "", summary: "", start: "", end: "", htmlLink: "", status: "" });
  });
});

describe("calendarApiError", () => {
  it("adds the enable-the-API hint on 403", () => {
    assert.match(calendarApiError(403, "").message, /is the Google Calendar API enabled/);
  });

  it("has no hint on other statuses", () => {
    assert.doesNotMatch(calendarApiError(500, "").message, /enabled/);
    assert.match(calendarApiError(500, "").message, /HTTP 500/);
  });

  it("includes and truncates a long error body", () => {
    const { message } = calendarApiError(400, "x".repeat(1000));
    assert.ok(message.length < 500, `message unexpectedly long: ${message.length}`);
    assert.match(message, /x{10}/);
  });

  it("omits the body separator when the body is empty", () => {
    assert.equal(calendarApiError(401, "").message, "Google Calendar API: HTTP 401");
  });
});
