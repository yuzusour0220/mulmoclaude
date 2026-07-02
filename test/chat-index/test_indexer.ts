import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { readFile, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { indexSession, readManifest, isFresh, sessionJsonlChangedSinceIndex, MIN_INDEX_INTERVAL_MS } from "../../server/workspace/chat-index/indexer.js";
import { indexEntryPathFor, manifestPathFor } from "../../server/workspace/chat-index/paths.js";
import type { SummaryResult } from "../../server/workspace/chat-index/types.js";

let workspace: string;
// Mirrors WORKSPACE_DIRS.chat (`conversations/chat`) — the value
// the indexer resolves through `chatDirFor` at runtime.
const CHAT_REL = join("conversations", "chat");

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "chat-index-test-"));
  mkdirSync(join(workspace, CHAT_REL), { recursive: true });
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

// Helper: seed a session jsonl + matching meta file so the indexer
// has something real to read. Returns the session id.
function seedSession(
  sessionId: string,
  opts: {
    roleId?: string;
    startedAt?: string;
    userMessages?: string[];
    assistantMessages?: string[];
  } = {},
): string {
  const {
    roleId = "general",
    startedAt = "2026-04-12T10:00:00.000Z",
    userMessages = ["Can you help me plan a project?"],
    assistantMessages = ["Sure — tell me what it's about."],
  } = opts;
  const chatDir = join(workspace, CHAT_REL);
  writeFileSync(join(chatDir, `${sessionId}.json`), JSON.stringify({ roleId, startedAt }));
  const lines: string[] = [];
  for (let i = 0; i < Math.max(userMessages.length, assistantMessages.length); i++) {
    if (userMessages[i] !== undefined) {
      lines.push(
        JSON.stringify({
          source: "user",
          type: "text",
          message: userMessages[i],
        }),
      );
    }
    if (assistantMessages[i] !== undefined) {
      lines.push(
        JSON.stringify({
          source: "assistant",
          type: "text",
          message: assistantMessages[i],
        }),
      );
    }
  }
  writeFileSync(join(chatDir, `${sessionId}.jsonl`), `${lines.join("\n")}\n`);
  return sessionId;
}

// Helper: build a stub summarize function that records calls and
// returns a deterministic result.
function makeStubSummarize(
  result: SummaryResult = {
    title: "stub title",
    summary: "stub summary",
    keywords: ["stub", "keyword"],
  },
): { fn: (input: string) => Promise<SummaryResult>; calls: string[] } {
  const calls: string[] = [];
  return {
    fn: async (input: string) => {
      calls.push(input);
      return result;
    },
    calls,
  };
}

describe("indexSession — happy path", () => {
  it("writes a per-session entry and upserts the manifest", async () => {
    seedSession("sess-A");
    const stub = makeStubSummarize({
      title: "Plan a project",
      summary: "User wants help planning something.",
      keywords: ["project", "plan"],
    });

    const entry = await indexSession(workspace, "sess-A", {
      summarize: stub.fn,
      now: () => Date.parse("2026-04-12T10:05:00.000Z"),
    });

    assert.ok(entry !== null);
    assert.equal(entry.id, "sess-A");
    assert.equal(entry.title, "Plan a project");
    assert.equal(entry.roleId, "general");
    assert.equal(entry.startedAt, "2026-04-12T10:00:00.000Z");

    // Per-session file exists.
    const perSession = JSON.parse(await readFile(indexEntryPathFor(workspace, "sess-A"), "utf-8"));
    assert.equal(perSession.title, "Plan a project");

    // Manifest upserted.
    const manifest = await readManifest(workspace);
    assert.equal(manifest.entries.length, 1);
    assert.equal(manifest.entries[0].id, "sess-A");

    // Summarizer was called once with the extracted transcript.
    assert.equal(stub.calls.length, 1);
    assert.match(stub.calls[0], /Can you help me plan a project/);
  });
});

describe("indexSession — freshness throttle", () => {
  it("skips when the existing entry is < MIN_INDEX_INTERVAL_MS old", async () => {
    seedSession("sess-B");
    const stub = makeStubSummarize();

    // First run to seed the index entry at t=0.
    await indexSession(workspace, "sess-B", {
      summarize: stub.fn,
      now: () => 0,
    });
    assert.equal(stub.calls.length, 1);

    // Second run 5 min later — still inside the 15-min window.
    const result = await indexSession(workspace, "sess-B", {
      summarize: stub.fn,
      now: () => 5 * 60 * 1000,
    });
    assert.equal(result, null);
    assert.equal(stub.calls.length, 1); // not called again
  });

  it("re-indexes after the freshness window elapses", async () => {
    seedSession("sess-C");
    const stub = makeStubSummarize();

    await indexSession(workspace, "sess-C", {
      summarize: stub.fn,
      now: () => 0,
    });
    assert.equal(stub.calls.length, 1);

    // Advance beyond the window.
    const result = await indexSession(workspace, "sess-C", {
      summarize: stub.fn,
      now: () => MIN_INDEX_INTERVAL_MS + 1,
    });
    assert.ok(result !== null);
    assert.equal(stub.calls.length, 2);
  });

  it("force: true bypasses the freshness throttle", async () => {
    seedSession("sess-force");
    const stub = makeStubSummarize();

    // Seed a fresh entry at t=0.
    await indexSession(workspace, "sess-force", {
      summarize: stub.fn,
      now: () => 0,
    });
    assert.equal(stub.calls.length, 1);

    // Second call 1 second later — normally skipped, but
    // force: true re-indexes anyway.
    const refreshed = await indexSession(workspace, "sess-force", {
      summarize: stub.fn,
      now: () => 1000,
      force: true,
    });
    assert.ok(refreshed !== null);
    assert.equal(stub.calls.length, 2);
  });

  it("respects a custom minIntervalMs", async () => {
    seedSession("sess-D");
    const stub = makeStubSummarize();

    await indexSession(workspace, "sess-D", {
      summarize: stub.fn,
      now: () => 0,
      minIntervalMs: 1000,
    });
    // 500 ms later — still fresh under the 1000 ms window.
    const skipped = await indexSession(workspace, "sess-D", {
      summarize: stub.fn,
      now: () => 500,
      minIntervalMs: 1000,
    });
    assert.equal(skipped, null);
    // 2000 ms later — window elapsed.
    const refreshed = await indexSession(workspace, "sess-D", {
      summarize: stub.fn,
      now: () => 2000,
      minIntervalMs: 1000,
    });
    assert.ok(refreshed !== null);
  });
});

describe("indexSession — skip conditions", () => {
  it("returns null for a missing jsonl", async () => {
    const stub = makeStubSummarize();
    const result = await indexSession(workspace, "no-such-session", {
      summarize: stub.fn,
      now: () => 0,
    });
    assert.equal(result, null);
    assert.equal(stub.calls.length, 0);
  });

  it("returns null for an empty jsonl (no text turns)", async () => {
    seedSession("sess-E", { userMessages: [], assistantMessages: [] });
    const stub = makeStubSummarize();
    const result = await indexSession(workspace, "sess-E", {
      summarize: stub.fn,
      now: () => 0,
    });
    assert.equal(result, null);
    assert.equal(stub.calls.length, 0);
  });

  it("returns null when the jsonl only has tool_result entries", async () => {
    const chatDir = join(workspace, CHAT_REL);
    writeFileSync(
      join(chatDir, "sess-F.json"),
      JSON.stringify({
        roleId: "general",
        startedAt: "2026-04-12T10:00:00.000Z",
      }),
    );
    writeFileSync(join(chatDir, "sess-F.jsonl"), `${JSON.stringify({ source: "tool", type: "tool_result", message: "x" })}\n`);
    const stub = makeStubSummarize();
    const result = await indexSession(workspace, "sess-F", {
      summarize: stub.fn,
      now: () => 0,
    });
    assert.equal(result, null);
    assert.equal(stub.calls.length, 0);
  });
});

describe("indexSession — manifest upsert and ordering", () => {
  it("replaces an existing entry for the same id", async () => {
    seedSession("sess-G");
    const firstStub = makeStubSummarize({
      title: "first",
      summary: "first summary",
      keywords: ["a"],
    });
    await indexSession(workspace, "sess-G", {
      summarize: firstStub.fn,
      now: () => 0,
    });

    // Second run past the freshness window, with a different title.
    const secondStub = makeStubSummarize({
      title: "second",
      summary: "second summary",
      keywords: ["b"],
    });
    await indexSession(workspace, "sess-G", {
      summarize: secondStub.fn,
      now: () => MIN_INDEX_INTERVAL_MS + 1,
    });

    const manifest = await readManifest(workspace);
    assert.equal(manifest.entries.length, 1);
    assert.equal(manifest.entries[0].title, "second");
  });

  it("sorts manifest entries newest-startedAt first", async () => {
    seedSession("oldest", { startedAt: "2026-04-10T10:00:00.000Z" });
    seedSession("newest", { startedAt: "2026-04-12T10:00:00.000Z" });
    seedSession("middle", { startedAt: "2026-04-11T10:00:00.000Z" });

    const stub = makeStubSummarize();
    await indexSession(workspace, "oldest", {
      summarize: stub.fn,
      now: () => 0,
    });
    await indexSession(workspace, "newest", {
      summarize: stub.fn,
      now: () => 0,
    });
    await indexSession(workspace, "middle", {
      summarize: stub.fn,
      now: () => 0,
    });

    const manifest = await readManifest(workspace);
    assert.deepEqual(
      manifest.entries.map((entry) => entry.id),
      ["newest", "middle", "oldest"],
    );
  });
});

describe("indexSession — error propagation", () => {
  it("does not write the manifest or per-session file when summarize throws", async () => {
    seedSession("sess-H");
    const failing = async () => {
      throw new Error("boom");
    };

    await assert.rejects(
      () =>
        indexSession(workspace, "sess-H", {
          summarize: failing,
          now: () => 0,
        }),
      /boom/,
    );

    const manifest = await readManifest(workspace);
    assert.equal(manifest.entries.length, 0);

    await assert.rejects(() => readFile(indexEntryPathFor(workspace, "sess-H"), "utf-8"));
  });
});

describe("readManifest", () => {
  it("returns an empty manifest when the file is missing", async () => {
    const manifest = await readManifest(workspace);
    assert.deepEqual(manifest, { version: 1, entries: [] });
  });

  it("returns an empty manifest when the file is corrupted", async () => {
    mkdirSync(join(workspace, CHAT_REL, "index"), { recursive: true });
    writeFileSync(manifestPathFor(workspace), "{ not json");
    const manifest = await readManifest(workspace);
    assert.deepEqual(manifest, { version: 1, entries: [] });
  });

  it("returns an empty manifest for a version mismatch", async () => {
    mkdirSync(join(workspace, CHAT_REL, "index"), { recursive: true });
    writeFileSync(manifestPathFor(workspace), JSON.stringify({ version: 99, entries: [] }));
    const manifest = await readManifest(workspace);
    assert.deepEqual(manifest, { version: 1, entries: [] });
  });
});

describe("isFresh", () => {
  it("returns false when no entry file exists", async () => {
    const out = await isFresh(workspace, "nope", 0, MIN_INDEX_INTERVAL_MS);
    assert.equal(out, false);
  });

  it("returns true when the entry is within the window", async () => {
    mkdirSync(join(workspace, CHAT_REL, "index"), { recursive: true });
    writeFileSync(indexEntryPathFor(workspace, "x"), JSON.stringify({ indexedAt: new Date(0).toISOString() }));
    const out = await isFresh(workspace, "x", 5000, MIN_INDEX_INTERVAL_MS);
    assert.equal(out, true);
  });

  it("returns false when the entry is outside the window", async () => {
    mkdirSync(join(workspace, CHAT_REL, "index"), { recursive: true });
    writeFileSync(indexEntryPathFor(workspace, "x"), JSON.stringify({ indexedAt: new Date(0).toISOString() }));
    const out = await isFresh(workspace, "x", MIN_INDEX_INTERVAL_MS + 1, MIN_INDEX_INTERVAL_MS);
    assert.equal(out, false);
  });
});

describe("sessionJsonlChangedSinceIndex", () => {
  // A workspace-local jsonl path built by mirroring `chatDirFor`
  // (`conversations/chat`) — same shape the real indexer uses.
  const jsonlPathFor = (sessionId: string) => join(workspace, CHAT_REL, `${sessionId}.jsonl`);
  // Utility: freeze the jsonl mtime to a chosen seconds-since-epoch
  // so the mtime comparison against `indexedAt` is deterministic
  // instead of racing wall-clock disk timestamps.
  const setJsonlMtime = async (sessionId: string, epochSeconds: number) => utimes(jsonlPathFor(sessionId), epochSeconds, epochSeconds);

  it("returns true when no entry file exists (never indexed)", async () => {
    seedSession("mtime-a");
    assert.equal(await sessionJsonlChangedSinceIndex(workspace, "mtime-a"), true);
  });

  it("returns true when the entry file is malformed", async () => {
    seedSession("mtime-b");
    mkdirSync(join(workspace, CHAT_REL, "index"), { recursive: true });
    writeFileSync(indexEntryPathFor(workspace, "mtime-b"), "{ not json");
    assert.equal(await sessionJsonlChangedSinceIndex(workspace, "mtime-b"), true);
  });

  it("returns false when jsonl mtime is older than the entry's indexedAt (content unchanged)", async () => {
    seedSession("mtime-c");
    // Freeze the jsonl at t=100ms (0.1s) so it can't be newer than
    // the entry we stamp below at t=1000ms.
    await setJsonlMtime("mtime-c", 0.1);
    mkdirSync(join(workspace, CHAT_REL, "index"), { recursive: true });
    writeFileSync(indexEntryPathFor(workspace, "mtime-c"), JSON.stringify({ indexedAt: new Date(1000).toISOString() }));
    assert.equal(await sessionJsonlChangedSinceIndex(workspace, "mtime-c"), false);
  });

  it("returns true when jsonl mtime is newer than the entry's indexedAt (new turn arrived)", async () => {
    seedSession("mtime-d");
    // Jsonl bumped forward to t=2000s (2_000_000ms epoch), long after
    // the entry we stamp at t=1000ms.
    await setJsonlMtime("mtime-d", 2000);
    mkdirSync(join(workspace, CHAT_REL, "index"), { recursive: true });
    writeFileSync(indexEntryPathFor(workspace, "mtime-d"), JSON.stringify({ indexedAt: new Date(1000).toISOString() }));
    assert.equal(await sessionJsonlChangedSinceIndex(workspace, "mtime-d"), true);
  });

  it("returns false when the jsonl is missing (nothing to reindex)", async () => {
    // Entry file exists but no jsonl companion — an inconsistency
    // that shouldn't happen at rest, but the helper must not throw.
    mkdirSync(join(workspace, CHAT_REL, "index"), { recursive: true });
    writeFileSync(indexEntryPathFor(workspace, "mtime-e"), JSON.stringify({ indexedAt: new Date(0).toISOString() }));
    assert.equal(await sessionJsonlChangedSinceIndex(workspace, "mtime-e"), false);
  });
});

describe("indexSession — content-unchanged skip (issue #1929)", () => {
  const jsonlPathFor = (sessionId: string) => join(workspace, CHAT_REL, `${sessionId}.jsonl`);
  const setJsonlMtime = async (sessionId: string, epochSeconds: number) => utimes(jsonlPathFor(sessionId), epochSeconds, epochSeconds);

  it("skips a session whose jsonl mtime hasn't moved since the last index", async () => {
    seedSession("skip-unchanged");
    // Freeze jsonl mtime at 100ms so the first-index-at-1000ms entry
    // guarantees jsonl.mtime <= indexedAt on the second call.
    await setJsonlMtime("skip-unchanged", 0.1);
    const stub = makeStubSummarize();

    await indexSession(workspace, "skip-unchanged", { summarize: stub.fn, now: () => 1000 });
    assert.equal(stub.calls.length, 1);

    // Jump past the freshness window so isFresh returns false; the
    // ONLY remaining reason to skip is the content-unchanged gate.
    await indexSession(workspace, "skip-unchanged", { summarize: stub.fn, now: () => MIN_INDEX_INTERVAL_MS + 10_000 });
    assert.equal(stub.calls.length, 1);
  });

  it("re-indexes a session whose jsonl mtime moved forward", async () => {
    seedSession("resume-changed");
    await setJsonlMtime("resume-changed", 0.1);
    const stub = makeStubSummarize();

    await indexSession(workspace, "resume-changed", { summarize: stub.fn, now: () => 1000 });
    assert.equal(stub.calls.length, 1);

    // Simulate a new turn: bump the jsonl mtime past the entry's
    // indexedAt. Time-jump past the freshness window too so this
    // isn't just testing isFresh.
    await setJsonlMtime("resume-changed", 5000);
    await indexSession(workspace, "resume-changed", { summarize: stub.fn, now: () => MIN_INDEX_INTERVAL_MS + 10_000 });
    assert.equal(stub.calls.length, 2);
  });

  it("force: true bypasses the content-unchanged gate", async () => {
    seedSession("force-through");
    await setJsonlMtime("force-through", 0.1);
    const stub = makeStubSummarize();

    await indexSession(workspace, "force-through", { summarize: stub.fn, now: () => 1000 });
    assert.equal(stub.calls.length, 1);

    // Jsonl still at 100ms — content-unchanged gate would skip, but
    // force says "regenerate anyway".
    await indexSession(workspace, "force-through", {
      summarize: stub.fn,
      now: () => MIN_INDEX_INTERVAL_MS + 10_000,
      force: true,
    });
    assert.equal(stub.calls.length, 2);
  });
});
