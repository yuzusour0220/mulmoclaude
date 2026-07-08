// Shared dispatch for a scheduled or manually-triggered skill / user task:
// spawn its chat, record the run (history + last/next-run state), and surface a
// dispatch error. Used by both the skill scheduler and the user-task scheduler
// so each run wrapper stays a thin description of *what* to dispatch.

import { recordExternalRun, type TaskTrigger } from "../../events/scheduler-adapter.js";
import type { TaskSchedule } from "../../events/task-manager/index.js";
import type { SessionOrigin } from "../../../src/types/session.js";
import { log } from "../../system/logger/index.js";
import { makeUuid } from "../../utils/id.js";
import { errorMessage } from "../../utils/errors.js";

type StartChat = (params: { message: string; roleId: string; chatSessionId: string; origin?: SessionOrigin }) => Promise<{ kind: string; error?: string }>;

export interface ScheduledDispatch {
  /** Task-manager id (`skill.<name>` / `user.<uuid>`) — state/log key. */
  id: string;
  name: string;
  schedule: TaskSchedule;
  /** `/skill-name` for a skill, the prompt for a user task. */
  message: string;
  roleId: string;
  origin: SessionOrigin;
  trigger: TaskTrigger;
  /** Logger scope + a label for the thrown-on-failure message. */
  logScope: string;
  failureLabel: string;
  startChat: StartChat;
}

/** Dispatch one scheduled task's chat and record the run. Returns the spawned
 *  chat session id; throws on a dispatch error so the task-manager tick logs the
 *  failure. `startChat` returns after *starting* the session, so the recorded
 *  run reflects the dispatch, not the chat's eventual outcome. The run is
 *  recorded in EVERY case — success, an error result, OR a rejected promise —
 *  before rethrowing, so a failed dispatch still leaves a trace in history/state. */
export async function fireScheduledChat(dispatch: ScheduledDispatch): Promise<string> {
  const { id, name, schedule, message, roleId, origin, trigger, logScope, failureLabel, startChat } = dispatch;
  const chatSessionId = makeUuid();
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  log.info(logScope, "running scheduled task", { name, roleId, chatSessionId });

  const failure = await dispatchFailure(() => startChat({ message, roleId, chatSessionId, origin }));

  await recordExternalRun({
    id,
    name,
    schedule,
    scheduledFor: startedAt,
    startedAt,
    durationMs: Date.now() - startMs,
    trigger,
    errorMessage: failure,
    chatSessionId,
  });
  if (failure !== null) throw new Error(`${failureLabel} failed: ${failure}`);
  log.info(logScope, "scheduled task completed", { name, chatSessionId });
  return chatSessionId;
}

/** Run the dispatch and normalize its outcome to an error string (or null on
 *  success), collapsing both an `{ kind: "error" }` result and a thrown/rejected
 *  promise into the same failure so neither escapes the run record. */
async function dispatchFailure(dispatch: () => Promise<{ kind: string; error?: string }>): Promise<string | null> {
  try {
    const result = await dispatch();
    return result.kind === "error" ? (result.error ?? "unknown") : null;
  } catch (err) {
    return errorMessage(err);
  }
}
