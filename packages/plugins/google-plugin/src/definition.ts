// Tool schema for the single `google` tool. The LLM picks a `kind`;
// the dispatch in `index.ts` validates with Zod and routes to the
// matching engine call in @mulmoclaude/core/google.
//
// `name: "google" as const` narrows the literal so `definePlugin`'s
// `PluginFactoryResult<N>` requires a handler exported under exactly
// this key.

export const TOOL_DEFINITION = {
  type: "function" as const,
  name: "google" as const,
  prompt:
    "The user's Google account is linked LOCALLY on this machine — the refresh token lives in ~/.config/mulmo/ and never reaches any cloud. " +
    "This is independent of claude.ai Google connectors; the tool works without them. " +
    "If a call fails with 'Google account not linked', ask the user to link it in Settings → Plugins → Google (or run `yarn google:auth`), then retry the original call.",
  description:
    "Operate the user's Google services through the locally linked Google account. Currently Google Calendar (the primary calendar). Supported kinds:\n" +
    " - `status`: report whether the Google account is linked on this machine — call this first when unsure.\n" +
    " - `calendarListEvents`: list upcoming events. Optional `timeMin` (ISO 8601 date-time with timezone offset; default now) and `maxResults` (1-50, default 10).\n" +
    " - `calendarCreateEvent`: create an event. Requires `summary`, `start`, `end` — ISO 8601 date-times WITH a timezone offset (e.g. 2026-07-17T09:00:00+09:00); optional `description`.",
  parameters: {
    type: "object" as const,
    properties: {
      kind: { type: "string", enum: ["status", "calendarListEvents", "calendarCreateEvent"] },
      timeMin: { type: "string", description: "calendarListEvents: lower bound, ISO 8601 with timezone offset (default: now)" },
      maxResults: { type: "number", description: "calendarListEvents: max events to return, 1-50 (default 10)" },
      summary: { type: "string", description: "calendarCreateEvent: event title" },
      start: { type: "string", description: "calendarCreateEvent: start, ISO 8601 with timezone offset" },
      end: { type: "string", description: "calendarCreateEvent: end, ISO 8601 with timezone offset" },
      description: { type: "string", description: "calendarCreateEvent: optional event body" },
    },
    required: ["kind"],
  },
};
