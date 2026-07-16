// google.calendar.* command handlers (remote-host).
//
// The remote (phone) triggers these over the Firestore command channel; the
// Calendar call itself runs here on the host with the locally stored OAuth
// token, so no Google credential ever reaches the cloud. Factories keep the
// validation + mapping unit-testable with the engine stubbed; the default
// exports wire the real auth/calendar functions.
import { getGoogleAccessToken } from "../../services/google/auth.js";
import { createCalendarEvent, DEFAULT_LIST_MAX_RESULTS, listCalendarEvents, MAX_LIST_RESULTS } from "../../services/google/calendar.js";
import type { CommandHandler, JsonObject } from "../commandChannel.js";

export interface GoogleCalendarDeps {
  getAccessToken: typeof getGoogleAccessToken;
  createEvent: typeof createCalendarEvent;
  listEvents: typeof listCalendarEvents;
}

const requiredString = (params: JsonObject, key: string): string => {
  const value = params[key];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${key} must be a non-empty string`);
  return value;
};

const asDateTime = (value: string, key: string): string => {
  if (Number.isNaN(new Date(value).getTime())) throw new Error(`${key} must be an ISO 8601 date-time string`);
  return value;
};

const optionalDateTime = (params: JsonObject, key: string): string | undefined => {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${key} must be an ISO 8601 date-time string`);
  return asDateTime(value, key);
};

const clampMaxResults = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isInteger(value)) return DEFAULT_LIST_MAX_RESULTS;
  return Math.min(Math.max(value, 1), MAX_LIST_RESULTS);
};

export const createGoogleCalendarCreateEvent =
  (deps: GoogleCalendarDeps): CommandHandler =>
  async (params: JsonObject) => {
    const input = {
      summary: requiredString(params, "summary"),
      startDateTime: asDateTime(requiredString(params, "start"), "start"),
      endDateTime: asDateTime(requiredString(params, "end"), "end"),
      description: typeof params.description === "string" ? params.description : undefined,
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
    const events = await deps.listEvents(await deps.getAccessToken(), { timeMin, maxResults });
    return { events: events.map((event) => ({ ...event })) };
  };

const deps: GoogleCalendarDeps = { getAccessToken: getGoogleAccessToken, createEvent: createCalendarEvent, listEvents: listCalendarEvents };
export const googleCalendarCreateEvent = createGoogleCalendarCreateEvent(deps);
export const googleCalendarListEvents = createGoogleCalendarListEvents(deps);
