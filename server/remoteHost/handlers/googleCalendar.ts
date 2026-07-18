// google.calendar.* command handlers (remote-host).
//
// The remote (phone) triggers these over the Firestore command channel; the
// Calendar call itself runs here on the host with the locally stored OAuth
// token, so no Google credential ever reaches the cloud. Factories keep the
// validation + mapping unit-testable with the engine stubbed; the default
// exports wire the real auth/calendar functions.
import {
  createCalendarEvent,
  DEFAULT_LIST_MAX_RESULTS,
  getCalendarColors,
  getGoogleAccessToken,
  isIsoDateTimeWithOffset,
  listCalendarEvents,
  listCalendars,
  MAX_LIST_RESULTS,
  type CalendarColorEntry,
} from "@mulmoclaude/core/google";
import type { CommandHandler, JsonObject, JsonValue } from "../commandChannel.js";

export interface GoogleCalendarDeps {
  getAccessToken: typeof getGoogleAccessToken;
  createEvent: typeof createCalendarEvent;
  listEvents: typeof listCalendarEvents;
  listCalendars: typeof listCalendars;
  getColors: typeof getCalendarColors;
}

const requiredString = (params: JsonObject, key: string): string => {
  const value = params[key];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${key} must be a non-empty string`);
  return value;
};

const optionalString = (params: JsonObject, key: string): string | undefined => {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${key} must be a non-empty string`);
  // Return trimmed so whitespace can't reach the Google API (matches the
  // plugin's Zod .trim() normalization).
  return value.trim();
};

// Calendar's `dateTime`/`timeMin` are RFC3339 and reject date-only,
// offset-less, or impossible values with an opaque 400, so the strict shared
// validator runs here where the remote gets an actionable message.
const asDateTime = (value: string, key: string): string => {
  if (!isIsoDateTimeWithOffset(value)) throw new Error(`${key} must be an ISO 8601 date-time with a timezone offset (e.g. 2026-07-17T09:00:00+09:00)`);
  return value;
};

const optionalDateTime = (params: JsonObject, key: string): string | undefined => {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${key} must be an ISO 8601 date-time with a timezone offset (e.g. 2026-07-17T09:00:00+09:00)`);
  return asDateTime(value, key);
};

const clampMaxResults = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isInteger(value)) return DEFAULT_LIST_MAX_RESULTS;
  return Math.min(Math.max(value, 1), MAX_LIST_RESULTS);
};

// Spread rebuilds an anonymous object type — the named CalendarColorEntry
// interface (no index signature) can't satisfy the channel's structural
// JsonValue directly (same constraint as CalendarEventSummary).
const toColorMapJson = (map: Record<string, CalendarColorEntry>): JsonObject =>
  Object.fromEntries(
    Object.entries(map).map(([colorId, entry]): [string, JsonValue] => [colorId, { background: entry.background, foreground: entry.foreground }]),
  );

export const createGoogleCalendarCreateEvent =
  (deps: GoogleCalendarDeps): CommandHandler =>
  async (params: JsonObject) => {
    const input = {
      summary: requiredString(params, "summary"),
      startDateTime: asDateTime(requiredString(params, "start"), "start"),
      endDateTime: asDateTime(requiredString(params, "end"), "end"),
      description: typeof params.description === "string" ? params.description : undefined,
      calendarId: optionalString(params, "calendarId"),
      colorId: optionalString(params, "colorId"),
    };
    const event = await deps.createEvent(await deps.getAccessToken(), input);
    // Spread rebuilds an anonymous object type — the CalendarEventSummary
    // interface (no index signature) can't satisfy the channel's structural
    // JsonValue directly (same constraint as listAccountingBooks).
    return { event: { ...event } };
  };

export const createGoogleCalendarListEvents =
  (deps: GoogleCalendarDeps): CommandHandler =>
  async (params: JsonObject) => {
    const timeMin = optionalDateTime(params, "timeMin");
    const maxResults = clampMaxResults(params.maxResults);
    const calendarId = optionalString(params, "calendarId");
    const events = await deps.listEvents(await deps.getAccessToken(), { timeMin, maxResults, calendarId });
    return { events: events.map((event) => ({ ...event })) };
  };

export const createGoogleCalendarListCalendars =
  (deps: GoogleCalendarDeps): CommandHandler =>
  async () => {
    const calendars = await deps.listCalendars(await deps.getAccessToken());
    return { calendars: calendars.map((calendar) => ({ ...calendar })) };
  };

export const createGoogleCalendarColors =
  (deps: GoogleCalendarDeps): CommandHandler =>
  async () => {
    const colors = await deps.getColors(await deps.getAccessToken());
    return { colors: { event: toColorMapJson(colors.event), calendar: toColorMapJson(colors.calendar) } };
  };

const deps: GoogleCalendarDeps = {
  getAccessToken: getGoogleAccessToken,
  createEvent: createCalendarEvent,
  listEvents: listCalendarEvents,
  listCalendars,
  getColors: getCalendarColors,
};
export const googleCalendarCreateEvent = createGoogleCalendarCreateEvent(deps);
export const googleCalendarListEvents = createGoogleCalendarListEvents(deps);
export const googleCalendarListCalendars = createGoogleCalendarListCalendars(deps);
export const googleCalendarColors = createGoogleCalendarColors(deps);
