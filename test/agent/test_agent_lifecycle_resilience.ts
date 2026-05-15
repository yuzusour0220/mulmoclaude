// Batch 2: drive the fake-echo backend through the SAME consumer
// lifecycle that server/api/routes/agent.ts#runAgentInBackground
// uses (beginRun → for-await(events) → handleEvent → finally
// endRun) and assert the load-bearing invariant:
//
//   no matter how the turn fails, the session never gets stuck
//   `isRunning` — `endRun` in the consumer's `finally` always runs.
//
// A stuck `isRunning` is a real, user-visible failure: the UI spins
// forever and the 409 guard in `beginRun` rejects every subsequent
// turn on that session. Before the fake-echo seam this path needed
// a mocked Claude subprocess, so it had zero coverage.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  __resetForTests,
  getSession,
  getOrCreateSession,
  beginRun,
  endRun,
  cancelRun,
  initSessionStore,
  pushSessionEvent,
} from "../../server/events/session-store/index.ts";
import { fakeEchoBackend, setFakeResponse, resetFakeResponse } from "../../server/agent/backend/fake-echo.ts";
import type { AgentInput } from "../../server/agent/backend/types.ts";
import { ROLES, type Role } from "../../src/config/roles.ts";
import { EVENT_TYPES } from "../../src/types/events.ts";

function requireRole(roleId: string): Role {
  const role = ROLES.find((candidate) => candidate.id === roleId);
  if (!role) throw new Error(`test setup: role '${roleId}' not found`);
  return role;
}
const GENERAL_ROLE = requireRole("general");

function stubPubSub() {
  const published: { channel: string; data: Record<string, unknown> }[] = [];
  return {
    published,
    publish(channel: string, data: Record<string, unknown>) {
      published.push({ channel, data });
    },
    subscribe() {
      return () => {};
    },
  };
}

let pubsub: ReturnType<typeof stubPubSub>;

beforeEach(() => {
  __resetForTests();
  pubsub = stubPubSub();
  // initSessionStore expects an IPubSub; the stub covers the
  // publish/subscribe surface the store actually calls.
  initSessionStore(pubsub as unknown as Parameters<typeof initSessionStore>[0]);
});

afterEach(() => {
  resetFakeResponse();
  __resetForTests();
});

function makeInput(sessionId: string, overrides: Partial<AgentInput> = {}): AgentInput {
  return {
    systemPrompt: "test",
    message: "hello",
    role: GENERAL_ROLE,
    workspacePath: "/tmp/does-not-matter",
    sessionId,
    port: 0,
    activePlugins: [],
    extraAllowedTools: [],
    useDocker: false,
    ...overrides,
  };
}

// Mirrors the runAgentInBackground consumer loop closely enough to
// exercise the lifecycle invariant: beginRun, stream events into the
// session, convert a thrown error into an error event, always
// endRun in finally.
async function consumeTurn(sessionId: string, input: AgentInput): Promise<void> {
  try {
    for await (const event of fakeEchoBackend.runAgent(input)) {
      pushSessionEvent(sessionId, event as unknown as Record<string, unknown>);
    }
  } catch (err) {
    pushSessionEvent(sessionId, { type: EVENT_TYPES.error, message: String(err) });
  } finally {
    endRun(sessionId);
  }
}

function seedRunningSession(): string {
  const sessionId = `lc-${randomUUID()}`;
  getOrCreateSession(sessionId, {
    roleId: "general",
    resultsFilePath: "/tmp/fake.jsonl",
    startedAt: "2026-05-15T00:00:00.000Z",
    updatedAt: "2026-05-15T00:00:00.000Z",
  });
  const begun = beginRun(sessionId, () => {});
  assert.equal(begun, true, "beginRun should succeed on a fresh session");
  assert.equal(getSession(sessionId)?.isRunning, true);
  return sessionId;
}

describe("agent lifecycle resilience (fake-echo driven)", () => {
  it("error event: session ends not-running, error reached the channel", async () => {
    setFakeResponse(() => ({ error: "claude exited with code 1" }));
    const sessionId = seedRunningSession();

    await consumeTurn(sessionId, makeInput(sessionId));

    assert.equal(getSession(sessionId)?.isRunning, false, "endRun must clear isRunning after an error turn");
    const sawError = pubsub.published.some((entry) => entry.data?.type === EVENT_TYPES.error);
    assert.ok(sawError, "the error event must be published to the session channel");
  });

  it("throwing generator: error is caught, session still ends not-running", async () => {
    setFakeResponse(() => {
      throw new Error("boom in response generator");
    });
    const sessionId = seedRunningSession();

    await consumeTurn(sessionId, makeInput(sessionId));

    assert.equal(getSession(sessionId)?.isRunning, false, "a thrown generator must not leave the session stuck running");
    const errored = pubsub.published.find((entry) => entry.data?.type === EVENT_TYPES.error);
    assert.ok(errored, "the caught error must be surfaced as an error event");
    assert.match(String(errored?.data?.message), /boom in response generator/);
  });

  it("abort mid-turn: cancelRun fires the abort cb and the turn ends clean", async () => {
    const sessionId = `lc-${randomUUID()}`;
    getOrCreateSession(sessionId, {
      roleId: "general",
      resultsFilePath: "/tmp/fake.jsonl",
      startedAt: "2026-05-15T00:00:00.000Z",
      updatedAt: "2026-05-15T00:00:00.000Z",
    });
    const controller = new AbortController();
    let abortCbFired = false;
    beginRun(sessionId, () => {
      abortCbFired = true;
      controller.abort();
    });

    // The user hits cancel while the turn is in flight.
    const cancelled = cancelRun(sessionId);
    assert.equal(cancelled, true, "cancelRun returns true while running");
    assert.equal(abortCbFired, true, "cancelRun must invoke the registered abort cb");

    setFakeResponse(() => ({ text: "should be cut off by abort" }));
    await consumeTurn(sessionId, makeInput(sessionId, { abortSignal: controller.signal }));

    assert.equal(getSession(sessionId)?.isRunning, false, "endRun must run even when the turn was aborted");
    const sawText = pubsub.published.some((entry) => entry.data?.type === EVENT_TYPES.text);
    assert.ok(!sawText, "no assistant text should reach the channel after an abort");
  });

  it("partial stream (tool_call, no result): session still ends not-running", async () => {
    setFakeResponse(() => ({
      toolCalls: [{ toolName: "presentForm", args: { fields: [] } }],
      omitToolResult: true,
    }));
    const sessionId = seedRunningSession();

    await consumeTurn(sessionId, makeInput(sessionId));

    assert.equal(getSession(sessionId)?.isRunning, false, "a truncated tool round-trip must not hang the session");
  });

  it("empty stream: session ends not-running with no error", async () => {
    setFakeResponse(() => ({}));
    const sessionId = seedRunningSession();

    await consumeTurn(sessionId, makeInput(sessionId));

    assert.equal(getSession(sessionId)?.isRunning, false);
    const sawError = pubsub.published.some((entry) => entry.data?.type === EVENT_TYPES.error);
    assert.ok(!sawError, "an empty (but valid) stream is not an error");
  });

  it("next turn is accepted after a failed turn (409 guard not stuck)", async () => {
    setFakeResponse(() => ({ error: "first turn failed" }));
    const sessionId = seedRunningSession();
    await consumeTurn(sessionId, makeInput(sessionId));

    // The whole point of the invariant: a fresh beginRun must
    // succeed, proving the 409 guard isn't wedged by the failure.
    const secondBegin = beginRun(sessionId, () => {});
    assert.equal(secondBegin, true, "beginRun must succeed again after a failed turn");
  });
});
