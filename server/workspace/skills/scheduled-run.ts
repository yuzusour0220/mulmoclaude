// Shared dispatch for a scheduled or manually-triggered skill / user task:
// spawn its chat, record the run (history + last/next-run state), and surface a
// dispatch error. Used by both the skill scheduler and the user-task scheduler
// so each run wrapper stays a thin description of *what* to dispatch.

import { recordExternalRun, type TaskTrigger } from "../../events/scheduler-adapter.js";
import type { TaskSchedule } from "../../events/task-manager/index.js";
import type { SessionOrigin } from "../../../src/types/session.js";
import { log } from "../../system/logger/index.js";
import { makeUuid } from "../../utils/id.js";

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
 *  run reflects the dispatch, not the chat's eventual outcome. */
export async function fireScheduledChat(dispatch: ScheduledDispatch): Promise<string> {
  const { id, name, schedule, message, roleId, origin, trigger, logScope, failureLabel, startChat } = dispatch;
  const chatSessionId = makeUuid();
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  log.info(logScope, "running scheduled task", { name, roleId, chatSessionId });
  const result = await startChat({ message, roleId, chatSessionId, origin });
  const errorMessage = result.kind === "error" ? (result.error ?? "unknown") : null;
  await recordExternalRun({ id, name, schedule, scheduledFor: startedAt, startedAt, durationMs: Date.now() - startMs, trigger, errorMessage, chatSessionId });
  if (errorMessage !== null) throw new Error(`${failureLabel} failed: ${errorMessage}`);
  log.info(logScope, "scheduled task completed", { name, kind: result.kind });
  return chatSessionId;
}
