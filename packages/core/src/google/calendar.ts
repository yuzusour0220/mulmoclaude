// Google Calendar v3 REST calls against the user's primary calendar.
import { asRecord, googleApiError, googleRequest, stringField, DEFAULT_LIST_MAX_RESULTS } from "./apiClient.js";
import { isRecord } from "./util.js";

const CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const CALENDAR_API_LABEL = "Google Calendar API";

export interface CalendarEventInput {
  summary: string;
  startDateTime: string;
  endDateTime: string;
  description?: string;
}

export interface ListEventsInput {
  timeMin?: string;
  maxResults?: number;
}

export interface CalendarEventSummary {
  id: string;
  summary: string;
  start: string;
  end: string;
  htmlLink: string;
  status: string;
}

// All-day events carry `date`, timed events carry `dateTime`.
const eventTime = (value: unknown): string => {
  if (!isRecord(value)) return "";
  if (typeof value.dateTime === "string") return value.dateTime;
  if (typeof value.date === "string") return value.date;
  return "";
};

export const toEventSummary = (value: unknown): CalendarEventSummary => {
  const record = asRecord(value);
  return {
    id: stringField(record, "id"),
    summary: stringField(record, "summary"),
    start: eventTime(record.start),
    end: eventTime(record.end),
    htmlLink: stringField(record, "htmlLink"),
    status: stringField(record, "status"),
  };
};

/** Kept as a named export for the existing unit tests / callers; the shared
 *  helper now carries the wording. */
export const calendarApiError = (status: number, body: string): Error => googleApiError(CALENDAR_API_LABEL, status, body);

export async function createCalendarEvent(accessToken: string, input: CalendarEventInput): Promise<CalendarEventSummary> {
  const body = {
    summary: input.summary,
    description: input.description,
    start: { dateTime: input.startDateTime },
    end: { dateTime: input.endDateTime },
  };
  const created = await googleRequest(CALENDAR_API_LABEL, accessToken, CALENDAR_EVENTS_URL, { method: "POST", body: JSON.stringify(body) });
  return toEventSummary(created);
}

export async function listCalendarEvents(accessToken: string, input: ListEventsInput = {}): Promise<CalendarEventSummary[]> {
  const params = new URLSearchParams({
    timeMin: input.timeMin ?? new Date().toISOString(),
    maxResults: String(input.maxResults ?? DEFAULT_LIST_MAX_RESULTS),
    singleEvents: "true",
    orderBy: "startTime",
  });
  const listed = await googleRequest(CALENDAR_API_LABEL, accessToken, `${CALENDAR_EVENTS_URL}?${params.toString()}`);
  const record = asRecord(listed);
  const items = Array.isArray(record.items) ? record.items : [];
  return items.map(toEventSummary);
}
