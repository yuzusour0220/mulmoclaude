import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { configureScheduler, initScheduler, getSchedulerTaskState, resetSchedulerForTesting } from "@mulmoclaude/core/scheduler";
import { registerScheduledSkills, getScheduledSkills, runScheduledSkillNow } from "../../server/workspace/skills/scheduler.js";
import type { ITaskManager } from "../../server/events/task-manager/index.js";

const stubTm = (over: Partial<ITaskManager> = {}): ITaskManager => ({
  registerTask: () => {},
  removeTask: () => {},
  updateSchedule: () => true,
  start: () => {},
  stop: () => {},
  tick: async () => {},
  listTasks: () => [],
  ...over,
});

async function writeScheduledSkill(root: string, name: string): Promise<void> {
  const dir = join(root, ".claude", "skills", name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---\ndescription: ${name} description\nschedule: daily 08:00\n---\n\nBody`);
}

afterEach(() => resetSchedulerForTesting());

describe("skill scheduler visibility + manual run (#2012)", () => {
  it("lists a scheduled skill and fires it via runScheduledSkillNow, recording the run", async () => {
    const root = mkdtempSync(join(tmpdir(), "skillsched-"));
    try {
      configureScheduler({
        workspaceRoot: root,
        writeFileAtomic: async (filePath, content) => {
          await mkdir(dirname(filePath), { recursive: true });
          await writeFile(filePath, content);
        },
      });
      await initScheduler(stubTm(), []);
      await writeScheduledSkill(root, "news-filter");

      const calls: { message: string; chatSessionId: string }[] = [];
      await registerScheduledSkills({
        taskManager: stubTm(),
        workspaceRoot: root,
        startChat: async (params) => {
          calls.push({ message: params.message, chatSessionId: params.chatSessionId });
          return { kind: "started" };
        },
      });

      // A: the skill now appears with its task-manager id + parsed schedule.
      const mine = getScheduledSkills().find((skill) => skill.name === "news-filter");
      assert.ok(mine, "scheduled skill appears in getScheduledSkills()");
      assert.equal(mine.id, "skill.news-filter");
      assert.deepEqual(mine.schedule, { type: "daily", time: "08:00" });

      // C: manual run dispatches `/news-filter` and returns the chat session id.
      const chatSessionId = await runScheduledSkillNow("skill.news-filter");
      assert.ok(chatSessionId, "run returns a chat session id");
      assert.equal(calls.length, 1);
      assert.equal(calls[0].message, "/news-filter");

      // B: the run is recorded as state (history/last-run) under the skill id.
      const state = getSchedulerTaskState("skill.news-filter");
      assert.equal(state.totalRuns, 1);
      assert.equal(state.lastRunResult, "success");

      // Unknown id is not a skill → null (route falls through to system/404).
      assert.equal(await runScheduledSkillNow("skill.does-not-exist"), null);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
