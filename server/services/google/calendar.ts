// Google Calendar v3 REST calls against the user's primary calendar. Plain
// fetch instead of the `googleapis` SDK — two endpoints don't justify the
// dependency (see plans/feat-google-oauth-calendar.md).
import { errorMessage } from "../../utils/errors.js";
import { fetchWithTimeout } from "../../utils/fetch.js";
import { truncate } from "../../utils/text.js";
import { ONE_SECOND_MS } from "../../utils/time.js";
import { isRecord } from "../../utils/types.js";

const CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const CALENDAR_TIMEOUT_MS = 30 * ONE_SECOND_MS;
const ERROR_BODY_MAX_CHARS = 300;
const HTTP_FORBIDDEN = 403;
export const DEFAULT_LIST_MAX_RESULTS = 10;
export const MAX_LIST_RESULTS = 50;

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
  const record: Record<string, unknown> = isRecord(value) ? value : {};
  return {
    id: typeof record.id === "string" ? record.id : "",
    summary: typeof record.summary === "string" ? record.summary : "",
    start: eventTime(record.start),
    end: eventTime(record.end),
    htmlLink: typeof record.htmlLink === "string" ? record.htmlLink : "",
    status: typeof record.status === "string" ? record.status : "",
  };
};

export const calendarApiError = (status: number, body: string): Error => {
  const hint = status === HTTP_FORBIDDEN ? " (is the Google Calendar API enabled for the Cloud project?)" : "";
  const detail = body ? ` — ${truncate(body, ERROR_BODY_MAX_CHARS)}` : "";
  return new Error(`Google Calendar API: HTTP ${status}${hint}${detail}`);
};

const calendarRequest = async (accessToken: string, url: string, init: { method?: string; body?: string } = {}): Promise<unknown> => {
  const response = await fetchWithTimeout(url, {
    ...init,
    timeoutMs: CALENDAR_TIMEOUT_MS,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  });
  if (!response.ok) {
    const body = await response.text().catch((err: unknown) => errorMessage(err));
    throw calendarApiError(response.status, body);
  }
  return await response.json();
};

export async function createCalendarEvent(accessToken: string, input: CalendarEventInput): Promise<CalendarEventSummary> {
  const body = {
    summary: input.summary,
    description: input.description,
    start: { dateTime: input.startDateTime },
    end: { dateTime: input.endDateTime },
  };
  const created = await calendarRequest(accessToken, CALENDAR_EVENTS_URL, { method: "POST", body: JSON.stringify(body) });
  return toEventSummary(created);
}

export async function listCalendarEvents(accessToken: string, input: ListEventsInput = {}): Promise<CalendarEventSummary[]> {
  const params = new URLSearchParams({
    timeMin: input.timeMin ?? new Date().toISOString(),
    maxResults: String(input.maxResults ?? DEFAULT_LIST_MAX_RESULTS),
    singleEvents: "true",
    orderBy: "startTime",
  });
  const listed = await calendarRequest(accessToken, `${CALENDAR_EVENTS_URL}?${params.toString()}`);
  const items = isRecord(listed) && Array.isArray(listed.items) ? listed.items : [];
  return items.map(toEventSummary);
}
