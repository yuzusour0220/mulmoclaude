// Google plugin — server side. Thin dispatch over the shared engine in
// @mulmoclaude/core/google: the OAuth grant, token file, and Calendar
// REST calls are owned by core, so this tool, the host's settings UI,
// remote commands, and auth CLI all share one link state. Server-only
// (no Vue View) — results render as plain tool output in the chat.
// User-facing guidance stays host-neutral (#2128): the plugin runs on
// multiple hosts (MulmoClaude, MulmoTerminal) whose link flows differ,
// and each host's own help carries the specific steps.
import { definePlugin } from "gui-chat-protocol";
import {
  clientSecretPresence,
  createCalendarEvent,
  getGoogleAccessToken,
  listCalendarEvents,
  loadGoogleTokens,
  DEFAULT_LIST_MAX_RESULTS,
} from "@mulmoclaude/core/google";
import { GoogleArgs } from "./args";
import { TOOL_DEFINITION } from "./definition";

export { TOOL_DEFINITION };

const LINK_GUIDANCE = "Ask the user to link their Google account in this app's settings, then retry.";

export default definePlugin(({ log }) => {
  return {
    TOOL_DEFINITION,

    async google(rawArgs: unknown) {
      const args = GoogleArgs.parse(rawArgs);
      switch (args.kind) {
        case "status": {
          const [tokens, clientSecret] = await Promise.all([loadGoogleTokens(), clientSecretPresence()]);
          const linked = Boolean(tokens?.refresh_token);
          return { ok: true, linked, clientSecret, ...(linked ? {} : { guidance: LINK_GUIDANCE }) };
        }
        case "calendarListEvents": {
          const accessToken = await getGoogleAccessToken();
          const events = await listCalendarEvents(accessToken, {
            timeMin: args.timeMin,
            maxResults: args.maxResults ?? DEFAULT_LIST_MAX_RESULTS,
          });
          return { ok: true, events };
        }
        case "calendarCreateEvent": {
          const accessToken = await getGoogleAccessToken();
          const event = await createCalendarEvent(accessToken, {
            summary: args.summary,
            startDateTime: args.start,
            endDateTime: args.end,
            description: args.description,
          });
          // Log the id only — summaries/descriptions are personal content.
          log.info("calendar event created", { id: event.id });
          return { ok: true, event };
        }
        default: {
          const exhaustive: never = args;
          throw new Error(`unknown kind: ${JSON.stringify(exhaustive)}`);
        }
      }
    },
  };
});
