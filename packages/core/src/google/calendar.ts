// Google Calendar v3 REST calls. Events read/write against any calendar the
// user can access (default: their primary); the calendar list and colour
// palette let callers show non-primary calendars and their colours.
import { asRecord, googleApiError, googleRequest, itemsOf, stringField, DEFAULT_LIST_MAX_RESULTS } from "./apiClient.js";
import { isRecord } from "./util.js";

const CALENDAR_BASE_URL = "https://www.googleapis.com/calendar/v3";
const CALENDAR_API_LABEL = "Google Calendar API";
const DEFAULT_CALENDAR_ID = "primary";
// CalendarList.list is paginated; page through nextPageToken so an account
// with many subscribed calendars isn't silently truncated. The page cap is a
// runaway guard — 250 * 40 = 10k calendars, far beyond any real account.
const CALENDAR_LIST_PAGE_SIZE = 250;
const MAX_CALENDAR_LIST_PAGES = 40;

// `||` (not `??`) so an empty-string calendarId also falls back to primary
// instead of building a malformed `/calendars//events` URL.
const eventsUrl = (calendarId: string | undefined): string => `${CALENDAR_BASE_URL}/calendars/${encodeURIComponent(calendarId || DEFAULT_CALENDAR_ID)}/events`;

export interface CalendarEventInput {
  summary: string;
  startDateTime: string;
  endDateTime: string;
  description?: string;
  /** Calendar to create the event on; defaults to the user's primary. */
  calendarId?: string;
  /** Event colour (Google event palette id "1".."11"); omit to inherit the calendar's colour. */
  colorId?: string;
}

export interface ListEventsInput {
  timeMin?: string;
  maxResults?: number;
  /** Calendar to read; defaults to the user's primary. */
  calendarId?: string;
}

export interface CalendarEventSummary {
  id: string;
  summary: string;
  start: string;
  end: string;
  htmlLink: string;
  status: string;
  /** Google event palette id ("1".."11"), or "" when the event inherits the calendar's colour. */
  colorId: string;
}

export interface CalendarSummary {
  id: string;
  summary: string;
  description: string;
  /** True only for the user's primary calendar. */
  primary: boolean;
  accessRole: string;
  backgroundColor: string;
  foregroundColor: string;
  /** Calendar palette id backing background/foregroundColor. */
  colorId: string;
}

export interface CalendarColorEntry {
  background: string;
  foreground: string;
}

/** Palettes from Google's `/colors` endpoint: `event` maps an event's `colorId`
 *  and `calendar` maps a calendar's `colorId` to hex background/foreground. */
export interface CalendarColors {
  event: Record<string, CalendarColorEntry>;
  calendar: Record<string, CalendarColorEntry>;
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
    colorId: stringField(record, "colorId"),
  };
};

export const toCalendarSummary = (value: unknown): CalendarSummary => {
  const record = asRecord(value);
  return {
    id: stringField(record, "id"),
    summary: stringField(record, "summary"),
    description: stringField(record, "description"),
    primary: record.primary === true,
    accessRole: stringField(record, "accessRole"),
    backgroundColor: stringField(record, "backgroundColor"),
    foregroundColor: stringField(record, "foregroundColor"),
    colorId: stringField(record, "colorId"),
  };
};

const toColorMap = (value: unknown): Record<string, CalendarColorEntry> => {
  const entries = Object.entries(asRecord(value)).map(([colorId, entry]): [string, CalendarColorEntry] => {
    const record = asRecord(entry);
    return [colorId, { background: stringField(record, "background"), foreground: stringField(record, "foreground") }];
  });
  return Object.fromEntries(entries);
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
    ...(input.colorId ? { colorId: input.colorId } : {}),
  };
  const created = await googleRequest(CALENDAR_API_LABEL, accessToken, eventsUrl(input.calendarId), { method: "POST", body: JSON.stringify(body) });
  return toEventSummary(created);
}

export async function listCalendarEvents(accessToken: string, input: ListEventsInput = {}): Promise<CalendarEventSummary[]> {
  const params = new URLSearchParams({
    timeMin: input.timeMin ?? new Date().toISOString(),
    maxResults: String(input.maxResults ?? DEFAULT_LIST_MAX_RESULTS),
    singleEvents: "true",
    orderBy: "startTime",
  });
  const listed = await googleRequest(CALENDAR_API_LABEL, accessToken, `${eventsUrl(input.calendarId)}?${params.toString()}`);
  return itemsOf(listed).map(toEventSummary);
}

export interface CalendarListPage {
  items: unknown[];
  nextPageToken?: string;
}

/** Pagination loop for CalendarList.list, extracted so it can be tested without
 *  network. Stops at the last page (no token) or the runaway page cap. */
export async function collectCalendarPages(
  fetchPage: (pageToken?: string) => Promise<CalendarListPage>,
  maxPages = MAX_CALENDAR_LIST_PAGES,
): Promise<CalendarSummary[]> {
  const calendars: CalendarSummary[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const { items, nextPageToken } = await fetchPage(pageToken);
    calendars.push(...items.map(toCalendarSummary));
    if (!nextPageToken) break;
    pageToken = nextPageToken;
  }
  return calendars;
}

/** The calendars the user has added/subscribed to (primary + secondary +
 *  shared), each with its id, name and colour, following pagination. Needs the
 *  calendar-list read scope (GOOGLE_CALENDARLIST_SCOPE). */
export async function listCalendars(accessToken: string): Promise<CalendarSummary[]> {
  return collectCalendarPages(async (pageToken) => {
    const params = new URLSearchParams({ maxResults: String(CALENDAR_LIST_PAGE_SIZE) });
    if (pageToken) params.set("pageToken", pageToken);
    const payload = await googleRequest(CALENDAR_API_LABEL, accessToken, `${CALENDAR_BASE_URL}/users/me/calendarList?${params.toString()}`);
    const record = asRecord(payload);
    return { items: itemsOf(payload), nextPageToken: typeof record.nextPageToken === "string" ? record.nextPageToken : undefined };
  });
}

/** Resolve a `colorId` (on an event or calendar) to its hex background/foreground. */
export async function getCalendarColors(accessToken: string): Promise<CalendarColors> {
  const payload = await googleRequest(CALENDAR_API_LABEL, accessToken, `${CALENDAR_BASE_URL}/colors`);
  const record = asRecord(payload);
  return { event: toColorMap(record.event), calendar: toColorMap(record.calendar) };
}
