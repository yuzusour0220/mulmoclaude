// Unit tests for the Calendar REST mapping helpers — pure functions only, no
// network. The fetch path itself is covered by fetchWithTimeout's own tests.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { calendarApiError, toCalendarSummary, toEventSummary } from "@mulmoclaude/core/google";

const emptyEvent = { id: "", summary: "", start: "", end: "", htmlLink: "", status: "", colorId: "" };

describe("toEventSummary", () => {
  it("maps a timed event (dateTime) with its colour", () => {
    const summary = toEventSummary({
      id: "ev1",
      summary: "Standup",
      status: "confirmed",
      colorId: "7",
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
      colorId: "7",
    });
  });

  it("leaves colorId empty when the event inherits the calendar colour", () => {
    assert.equal(toEventSummary({ id: "ev2", start: { date: "2026-07-17" } }).colorId, "");
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
    assert.deepEqual(toEventSummary({}), emptyEvent);
  });

  it("tolerates a non-object payload", () => {
    assert.deepEqual(toEventSummary(null), emptyEvent);
  });

  it("ignores non-string field values", () => {
    const summary = toEventSummary({ id: 42, summary: ["x"], start: "not-an-object", colorId: 7 });
    assert.deepEqual(summary, emptyEvent);
  });
});

describe("toCalendarSummary", () => {
  it("maps a calendar-list entry with its colours", () => {
    const summary = toCalendarSummary({
      id: "team@group.calendar.google.com",
      summary: "Team",
      description: "shared team calendar",
      accessRole: "reader",
      backgroundColor: "#16a765",
      foregroundColor: "#ffffff",
      colorId: "8",
    });
    assert.deepEqual(summary, {
      id: "team@group.calendar.google.com",
      summary: "Team",
      description: "shared team calendar",
      primary: false,
      accessRole: "reader",
      backgroundColor: "#16a765",
      foregroundColor: "#ffffff",
      colorId: "8",
    });
  });

  it("marks the primary calendar only when primary === true", () => {
    assert.equal(toCalendarSummary({ id: "primary", primary: true }).primary, true);
    assert.equal(toCalendarSummary({ id: "other", primary: "true" }).primary, false);
    assert.equal(toCalendarSummary({ id: "none" }).primary, false);
  });

  it("fills empty strings for missing fields and tolerates a non-object payload", () => {
    const empty = { id: "", summary: "", description: "", primary: false, accessRole: "", backgroundColor: "", foregroundColor: "", colorId: "" };
    assert.deepEqual(toCalendarSummary({}), empty);
    assert.deepEqual(toCalendarSummary(null), empty);
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
