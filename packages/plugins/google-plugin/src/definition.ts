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
    "If a call fails with 'Google account not linked', ask the user to link their Google account in this app's settings, then retry the original call.",
  description:
    "Operate the user's Google services through the locally linked Google account: Calendar (primary calendar), Tasks, and Drive. Supported kinds:\n" +
    " - `status`: report whether the Google account is linked on this machine — call this first when unsure.\n" +
    "\n" +
    "Calendar:\n" +
    " - `calendarListEvents`: list upcoming events. Optional `timeMin` (ISO 8601 date-time with timezone offset; default now) and `maxResults` (1-50, default 10).\n" +
    " - `calendarCreateEvent`: create an event. Requires `summary`, `start`, `end` — ISO 8601 date-times WITH a timezone offset (e.g. 2026-07-17T09:00:00+09:00); optional `description`.\n" +
    "\n" +
    "Tasks:\n" +
    " - `taskListsList`: list the user's task lists (`id`, `title`). Only needed when the user means a list other than their default one.\n" +
    " - `tasksList`: list tasks. Optional `taskListId` (default: the user's default list), `maxResults` (1-50, default 10), `showCompleted` (default false).\n" +
    " - `tasksCreate`: add a task. Requires `title`; optional `notes`, `due` (ISO 8601 with offset — Google keeps the DATE only, so do not promise a time of day), `taskListId`.\n" +
    " - `tasksComplete`: mark a task done. Requires `taskId` (from `tasksList`); optional `taskListId`.\n" +
    "\n" +
    "Drive — IMPORTANT: this app can only see files IT created, never the user's wider Drive. Never claim you searched their whole Drive:\n" +
    " - `driveList`: list files this app created. Optional `maxResults` (1-50, default 10).\n" +
    " - `driveCreate`: create a text file. Requires `name` and `content`; optional `mimeType` (default text/plain).\n" +
    " - `driveRead`: read one of this app's files. Requires `fileId` (from `driveList` or `driveCreate`). Text files only.",
  parameters: {
    type: "object" as const,
    properties: {
      kind: {
        type: "string",
        enum: [
          "status",
          "calendarListEvents",
          "calendarCreateEvent",
          "taskListsList",
          "tasksList",
          "tasksCreate",
          "tasksComplete",
          "driveList",
          "driveCreate",
          "driveRead",
        ],
      },
      timeMin: { type: "string", description: "calendarListEvents: lower bound, ISO 8601 with timezone offset (default: now)" },
      maxResults: { type: "number", description: "list kinds: max items to return, 1-50 (default 10)" },
      summary: { type: "string", description: "calendarCreateEvent: event title" },
      start: { type: "string", description: "calendarCreateEvent: start, ISO 8601 with timezone offset" },
      end: { type: "string", description: "calendarCreateEvent: end, ISO 8601 with timezone offset" },
      description: { type: "string", description: "calendarCreateEvent: optional event body" },
      taskListId: { type: "string", description: "tasks kinds: target list id (default: the user's default list)" },
      showCompleted: { type: "boolean", description: "tasksList: include completed tasks (default false)" },
      title: { type: "string", description: "tasksCreate: task title" },
      notes: { type: "string", description: "tasksCreate: optional task notes" },
      due: { type: "string", description: "tasksCreate: optional due date, ISO 8601 with offset (Google keeps the date only)" },
      taskId: { type: "string", description: "tasksComplete: id of the task to mark done" },
      name: { type: "string", description: "driveCreate: file name" },
      content: { type: "string", description: "driveCreate: file body" },
      mimeType: { type: "string", description: "driveCreate: optional MIME type (default text/plain)" },
      fileId: { type: "string", description: "driveRead: id of a file this app created" },
    },
    required: ["kind"],
  },
};
