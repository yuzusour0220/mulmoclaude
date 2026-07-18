// Google plugin — server side. Thin dispatch over the shared engine in
// @mulmoclaude/core/google: the OAuth grant, token file, and the Calendar /
// Tasks / Drive REST calls are owned by core, so this tool, the host's
// settings UI, remote commands, and auth CLI all share one link state.
// Server-only (no Vue View) — results render as plain tool output in the
// chat. User-facing guidance stays host-neutral (#2128): the plugin runs on
// multiple hosts (MulmoClaude, MulmoTerminal) whose link flows differ, and
// each host's own help carries the specific steps.
import { definePlugin } from "gui-chat-protocol";
import {
  clientSecretPresence,
  completeTask,
  createCalendarEvent,
  createDriveFile,
  createTask,
  getCalendarColors,
  getGoogleAccessToken,
  listCalendarEvents,
  listCalendars,
  listDriveFiles,
  listTaskLists,
  listTasks,
  loadGoogleTokens,
  readDriveFile,
  DEFAULT_LIST_MAX_RESULTS,
} from "@mulmoclaude/core/google";
import { GoogleArgs } from "./args";
import { TOOL_DEFINITION } from "./definition";

export { TOOL_DEFINITION };

const LINK_GUIDANCE = "Ask the user to link their Google account in this app's settings, then retry.";

export default definePlugin(({ log }) => {
  const dispatch = async (args: GoogleArgs): Promise<unknown> => {
    switch (args.kind) {
      case "status": {
        const [tokens, clientSecret] = await Promise.all([loadGoogleTokens(), clientSecretPresence()]);
        const linked = Boolean(tokens?.refresh_token);
        return { ok: true, linked, clientSecret, ...(linked ? {} : { guidance: LINK_GUIDANCE }) };
      }
      case "calendarListCalendars": {
        return { ok: true, calendars: await listCalendars(await getGoogleAccessToken()) };
      }
      case "calendarColors": {
        return { ok: true, colors: await getCalendarColors(await getGoogleAccessToken()) };
      }
      case "calendarListEvents": {
        const events = await listCalendarEvents(await getGoogleAccessToken(), {
          calendarId: args.calendarId,
          timeMin: args.timeMin,
          maxResults: args.maxResults ?? DEFAULT_LIST_MAX_RESULTS,
        });
        return { ok: true, events };
      }
      case "calendarCreateEvent": {
        const event = await createCalendarEvent(await getGoogleAccessToken(), {
          summary: args.summary,
          startDateTime: args.start,
          endDateTime: args.end,
          description: args.description,
          calendarId: args.calendarId,
          colorId: args.colorId,
        });
        // Log ids only — titles / bodies are personal content.
        log.info("calendar event created", { id: event.id });
        return { ok: true, event };
      }
      case "taskListsList": {
        return { ok: true, taskLists: await listTaskLists(await getGoogleAccessToken()) };
      }
      case "tasksList": {
        const tasks = await listTasks(await getGoogleAccessToken(), {
          taskListId: args.taskListId,
          maxResults: args.maxResults ?? DEFAULT_LIST_MAX_RESULTS,
          showCompleted: args.showCompleted,
        });
        return { ok: true, tasks };
      }
      case "tasksCreate": {
        const task = await createTask(await getGoogleAccessToken(), {
          title: args.title,
          notes: args.notes,
          due: args.due,
          taskListId: args.taskListId,
        });
        log.info("task created", { id: task.id });
        return { ok: true, task };
      }
      case "tasksComplete": {
        const task = await completeTask(await getGoogleAccessToken(), { taskId: args.taskId, taskListId: args.taskListId });
        return { ok: true, task };
      }
      case "driveList": {
        const files = await listDriveFiles(await getGoogleAccessToken(), { maxResults: args.maxResults ?? DEFAULT_LIST_MAX_RESULTS });
        return { ok: true, files };
      }
      case "driveCreate": {
        const file = await createDriveFile(await getGoogleAccessToken(), { name: args.name, content: args.content, mimeType: args.mimeType });
        log.info("drive file created", { id: file.id });
        return { ok: true, file };
      }
      case "driveRead": {
        const { file, content } = await readDriveFile(await getGoogleAccessToken(), { fileId: args.fileId });
        return { ok: true, file, content };
      }
      default: {
        const exhaustive: never = args;
        throw new Error(`unknown kind: ${JSON.stringify(exhaustive)}`);
      }
    }
  };

  return {
    TOOL_DEFINITION,

    async google(rawArgs: unknown) {
      return await dispatch(GoogleArgs.parse(rawArgs));
    },
  };
});
