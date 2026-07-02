// Unit tests for the startChat remote-host handler: message composition (the
// collection slash-command prefix, with/without itemId), coercion, and the
// spawn wiring. The host spawner is stubbed so the test asserts what message it
// receives — not that a real chat subprocess launches.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { composeMessage, createStartChat, type StartChatDeps } from "../../server/remoteHost/handlers/startChat.js";

type SpawnArgs = Parameters<StartChatDeps["spawn"]>[0];

const captureSpawn = (result: Awaited<ReturnType<StartChatDeps["spawn"]>>) => {
  const calls: SpawnArgs[] = [];
  const spawn = (async (args: SpawnArgs) => {
    calls.push(args);
    return result;
  }) as StartChatDeps["spawn"];
  return { spawn, calls };
};

describe("composeMessage", () => {
  it("prefixes the collection slash command for a whole-collection chat", () => {
    assert.equal(composeMessage("clients", "", "who is overdue?"), "/clients who is overdue?");
  });

  it("scopes to a record with id= when an itemId is given", () => {
    assert.equal(composeMessage("clients", "acme", "draft a follow-up"), "/clients id=acme draft a follow-up");
  });
});

describe("createStartChat", () => {
  it("spawns a visible chat with the composed message and returns the chatId", async () => {
    const { spawn, calls } = captureSpawn({ ok: true, chatId: "chat-1" });
    const result = await createStartChat({ spawn })({ slug: "clients", itemId: "acme", message: "  hello  " });
    assert.deepEqual(result, { started: true, chatId: "chat-1" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].message, "/clients id=acme hello");
    assert.equal(calls[0].hidden, false);
  });

  it("omits id= when itemId is absent or null", async () => {
    const { spawn, calls } = captureSpawn({ ok: true, chatId: "chat-2" });
    await createStartChat({ spawn })({ slug: "clients", message: "hi" });
    assert.equal(calls[0].message, "/clients hi");
  });

  it("throws when slug is missing", async () => {
    const { spawn } = captureSpawn({ ok: true, chatId: "chat-3" });
    await assert.rejects(async () => createStartChat({ spawn })({ message: "hi" }), /slug is required/);
  });

  it("throws when message is blank", async () => {
    const { spawn } = captureSpawn({ ok: true, chatId: "chat-4" });
    await assert.rejects(async () => createStartChat({ spawn })({ slug: "clients", message: "   " }), /message is required/);
  });

  it("surfaces a spawn failure as a thrown error", async () => {
    const { spawn } = captureSpawn({ ok: false, error: "too many background sessions" });
    await assert.rejects(async () => createStartChat({ spawn })({ slug: "clients", message: "hi" }), /too many background sessions/);
  });
});
