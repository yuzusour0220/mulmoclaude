// Unit tests for the startChat remote-host handler.
//
// Two forms (see the handler header): the CURRENT free-text form (`{ message }`
// only, seeded verbatim) and the LEGACY `slug` form (`/<slug> [id=<itemId>]
// <message>` composition, feed refusal, token validation). The host spawner +
// collection engine are stubbed so the test asserts what message is spawned —
// not that a real chat subprocess launches.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { composeMessage, createStartChat, type StartChatDeps } from "../../server/remoteHost/handlers/startChat.js";

type SpawnArgs = Parameters<StartChatDeps["spawn"]>[0];
type Loaded = Awaited<ReturnType<StartChatDeps["loadCollection"]>>;

const collection = { source: "user" } as unknown as Loaded;
const feed = { source: "feed" } as unknown as Loaded;

// Build stub deps. `loadResult` is what `loadCollection` resolves to (only the
// legacy slug path calls it): a normal collection (default) ⇒ chat proceeds;
// `feed` ⇒ refused; `null` ⇒ unknown slug, rejected. `calls` captures the spawn
// arguments; `loadCalls` records whether the collection engine was consulted.
const makeDeps = (result: Awaited<ReturnType<StartChatDeps["spawn"]>>, loadResult: Loaded = collection) => {
  const calls: SpawnArgs[] = [];
  const loadCalls: string[] = [];
  const spawn = (async (args: SpawnArgs) => {
    calls.push(args);
    return result;
  }) as StartChatDeps["spawn"];
  const loadCollection = (async (slug: string) => {
    loadCalls.push(slug);
    return loadResult;
  }) as StartChatDeps["loadCollection"];
  return { deps: { spawn, loadCollection } as StartChatDeps, calls, loadCalls };
};

// ── CURRENT form: `{ message }` only, seeded verbatim ──────────────────────
describe("createStartChat — free-text form (current clients)", () => {
  it("spawns a visible chat with the message verbatim and returns the chatId", async () => {
    const { deps, calls, loadCalls } = makeDeps({ ok: true, chatId: "chat-1" });
    const result = await createStartChat(deps)({ message: "who is overdue?" });
    assert.deepEqual(result, { started: true, chatId: "chat-1" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].message, "who is overdue?");
    assert.equal(calls[0].hidden, false);
    // The collection engine is NOT consulted when no slug is sent.
    assert.equal(loadCalls.length, 0);
  });

  it("trims surrounding whitespace from the message", async () => {
    const { deps, calls } = makeDeps({ ok: true, chatId: "chat-2" });
    await createStartChat(deps)({ message: "  hello  " });
    assert.equal(calls[0].message, "hello");
  });

  it("passes a slash-command message through untouched (the host does not interpret it)", async () => {
    const { deps, calls, loadCalls } = makeDeps({ ok: true, chatId: "chat-3" });
    await createStartChat(deps)({ message: "/clients id=acme draft a follow-up" });
    assert.equal(calls[0].message, "/clients id=acme draft a follow-up");
    assert.equal(loadCalls.length, 0);
  });

  it("treats a null or empty-string slug as absent (free-text, no collection load)", async () => {
    const { deps, calls, loadCalls } = makeDeps({ ok: true, chatId: "chat-4" });
    await createStartChat(deps)({ message: "hi", slug: "" });
    await createStartChat(deps)({ message: "hi", slug: null });
    assert.deepEqual(
      calls.map((call) => call.message),
      ["hi", "hi"],
    );
    assert.equal(loadCalls.length, 0);
  });

  it("throws when message is blank, without spawning", async () => {
    const { deps, calls } = makeDeps({ ok: true, chatId: "chat-5" });
    await assert.rejects(async () => createStartChat(deps)({ message: "   " }), /message is required/);
    assert.equal(calls.length, 0);
  });

  it("throws when message is missing or non-string", async () => {
    const { deps } = makeDeps({ ok: true, chatId: "chat-6" });
    await assert.rejects(async () => createStartChat(deps)({}), /message is required/);
    await assert.rejects(async () => createStartChat(deps)({ message: 123 }), /message is required/);
  });

  it("surfaces a spawn failure as a thrown error", async () => {
    const { deps } = makeDeps({ ok: false, error: "too many background sessions" });
    await assert.rejects(async () => createStartChat(deps)({ message: "hi" }), /too many background sessions/);
  });
});

// ── LEGACY form: `{ slug, itemId?, message }` → composed slash command ──────
describe("composeMessage (legacy)", () => {
  it("prefixes the collection slash command for a whole-collection chat", () => {
    assert.equal(composeMessage("clients", "", "who is overdue?"), "/clients who is overdue?");
  });

  it("scopes to a record with id= when an itemId is given", () => {
    assert.equal(composeMessage("clients", "acme", "draft a follow-up"), "/clients id=acme draft a follow-up");
  });
});

describe("createStartChat — legacy slug form", () => {
  it("composes the /<slug> id= seed from a legacy client and returns the chatId", async () => {
    const { deps, calls, loadCalls } = makeDeps({ ok: true, chatId: "chat-1" });
    const result = await createStartChat(deps)({ slug: "clients", itemId: "acme", message: "  hello  " });
    assert.deepEqual(result, { started: true, chatId: "chat-1" });
    assert.equal(calls[0].message, "/clients id=acme hello");
    assert.deepEqual(loadCalls, ["clients"]);
  });

  it("omits id= when itemId is absent", async () => {
    const { deps, calls } = makeDeps({ ok: true, chatId: "chat-2" });
    await createStartChat(deps)({ slug: "clients", message: "hi" });
    assert.equal(calls[0].message, "/clients hi");
  });

  it("refuses feeds (no /<slug> command) without spawning", async () => {
    const { deps, calls } = makeDeps({ ok: true, chatId: "chat-feed" }, feed);
    await assert.rejects(async () => createStartChat(deps)({ slug: "news", message: "summarize" }), /not available for feeds/);
    assert.equal(calls.length, 0);
  });

  it("rejects an unknown slug (loadCollection returns null) without spawning", async () => {
    const { deps, calls } = makeDeps({ ok: true, chatId: "chat-missing" }, null);
    await assert.rejects(async () => createStartChat(deps)({ slug: "ghost", message: "hi" }), /collection 'ghost' not found/);
    assert.equal(calls.length, 0);
  });

  it("rejects a whitespace-containing or non-string slug (malformed prefix)", async () => {
    const { deps } = makeDeps({ ok: true, chatId: "chat-3" });
    await assert.rejects(async () => createStartChat(deps)({ slug: "a b", message: "hi" }), /slug must be a non-empty/);
    await assert.rejects(async () => createStartChat(deps)({ slug: 123, message: "hi" }), /slug must be a non-empty/);
  });

  it("rejects an itemId that is present but whitespace-containing", async () => {
    const { deps } = makeDeps({ ok: true, chatId: "chat-4" });
    await assert.rejects(async () => createStartChat(deps)({ slug: "clients", itemId: "a b", message: "hi" }), /itemId must be a non-empty/);
  });
});
