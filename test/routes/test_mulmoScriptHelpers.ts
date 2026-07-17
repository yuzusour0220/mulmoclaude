import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { MulmoBeat } from "@mulmocast/types";
import { buildBeatIdIndex, runStoryOp, type OpResult, type StoryContext } from "../../server/api/routes/mulmo-script-ops.js";

// buildBeatIdIndex only reads `beat.id`; the fixtures pass partial
// beats cast to MulmoBeat (same convention as fakeContext below).
const beats = (...ids: (string | undefined)[]): MulmoBeat[] => ids.map((beatId) => ({ id: beatId }) as unknown as MulmoBeat);

// A minimal stand-in for the mulmo studio context. `runStoryOp`
// treats it as an opaque value — it only checks truthiness and passes
// the reference to the handler.
const fakeContext = { studio: { script: {} } } as unknown as StoryContext;

const resolveOk = () => ({ ok: true, absolutePath: "/abs/stories/x.json" }) as const;

describe("runStoryOp — resolver rejects filePath", () => {
  it("short-circuits without calling buildContext or handler", async () => {
    let buildCalled = false;
    let handlerCalled = false;
    const result = await runStoryOp(
      "bad",
      {},
      async () => {
        handlerCalled = true;
        return { ok: true };
      },
      {
        resolveStory: () => ({ ok: false, code: "bad_request", error: "bad" }),
        buildContext: async () => {
          buildCalled = true;
          return fakeContext;
        },
      },
    );
    assert.equal(handlerCalled, false);
    assert.equal(buildCalled, false);
    assert.deepEqual(result, { ok: false, code: "bad_request", error: "bad" });
  });
});

describe("runStoryOp — buildContext returns undefined", () => {
  it("returns server_error with the standard mulmo-context message", async () => {
    let handlerCalled = false;
    const result = await runStoryOp(
      "stories/x.json",
      {},
      async () => {
        handlerCalled = true;
        return { ok: true };
      },
      {
        resolveStory: resolveOk,
        buildContext: async () => undefined,
      },
    );
    assert.equal(handlerCalled, false);
    assert.deepEqual(result, { ok: false, code: "server_error", error: "Failed to initialize mulmo context" });
  });

  it("uses onContextMissing override to emit a soft-fail payload", async () => {
    // Some ops (e.g. beatAudio) historically return an ok
    // `{ audio: null }` when the workspace context can't be
    // initialised yet, so the frontend can silently retry. The
    // override must bypass the default server_error.
    let handlerCalled = false;
    const result: OpResult<{ audio: string | null }> = await runStoryOp<{ audio: string | null }>(
      "stories/x.json",
      {
        onContextMissing: () => ({ ok: true, audio: null }),
      },
      async () => {
        handlerCalled = true;
        return { ok: true, audio: "unreachable" };
      },
      {
        resolveStory: resolveOk,
        buildContext: async () => undefined,
      },
    );
    assert.equal(handlerCalled, false);
    assert.deepEqual(result, { ok: true, audio: null });
  });
});

describe("runStoryOp — handler throws", () => {
  it("catches the error and returns server_error with errorMessage", async () => {
    const result = await runStoryOp(
      "stories/x.json",
      {},
      async () => {
        throw new Error("boom");
      },
      {
        resolveStory: resolveOk,
        buildContext: async () => fakeContext,
      },
    );
    assert.deepEqual(result, { ok: false, code: "server_error", error: "boom" });
  });

  it("handles a non-Error thrown value", async () => {
    const result = await runStoryOp(
      "stories/x.json",
      {},
      async () => {
        // eslint-disable-next-line no-throw-literal -- intentional non-Error throw, asserting runStoryOp converts unknown rejections to server_error
        throw "plain string";
      },
      {
        resolveStory: resolveOk,
        buildContext: async () => fakeContext,
      },
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /plain string/);
  });
});

describe("runStoryOp — happy path", () => {
  it("invokes handler with absoluteFilePath and context and returns its result", async () => {
    const received: { absoluteFilePath?: string; context?: unknown } = {};
    const result = await runStoryOp(
      "stories/x.json",
      {},
      async ({ absoluteFilePath, context }) => {
        received.absoluteFilePath = absoluteFilePath;
        received.context = context;
        return { ok: true, image: "data:image/png;base64,AAAA" };
      },
      {
        resolveStory: resolveOk,
        buildContext: async () => fakeContext,
      },
    );
    assert.equal(received.absoluteFilePath, "/abs/stories/x.json");
    assert.equal(received.context, fakeContext);
    assert.deepEqual(result, { ok: true, image: "data:image/png;base64,AAAA" });
  });

  it("forwards the force option to buildContext", async () => {
    let seenForce: boolean | undefined;
    await runStoryOp("stories/x.json", { force: true }, async () => ({ ok: true }), {
      resolveStory: resolveOk,
      buildContext: async (_fp, force) => {
        seenForce = force;
        return fakeContext;
      },
    });
    assert.equal(seenForce, true);
  });

  it("defaults force to false when option is omitted", async () => {
    let seenForce: boolean | undefined;
    await runStoryOp("stories/x.json", {}, async () => ({ ok: true }), {
      resolveStory: resolveOk,
      buildContext: async (_fp, force) => {
        seenForce = force;
        return fakeContext;
      },
    });
    assert.equal(seenForce, false);
  });
});

describe("buildBeatIdIndex", () => {
  it("maps each beat's id to its array index", () => {
    const index = buildBeatIdIndex(beats("intro", "body", "outro"));
    assert.deepEqual(
      [...index.entries()],
      [
        ["intro", 0],
        ["body", 1],
        ["outro", 2],
      ],
    );
  });

  it("falls back to __index__<n> for id-less beats", () => {
    const index = buildBeatIdIndex(beats(undefined, undefined));
    assert.equal(index.get("__index__0"), 0);
    assert.equal(index.get("__index__1"), 1);
  });

  it("mixes explicit ids and synthetic fallbacks", () => {
    const index = buildBeatIdIndex(beats("intro", undefined, "outro"));
    assert.equal(index.get("intro"), 0);
    assert.equal(index.get("__index__1"), 1);
    assert.equal(index.get("outro"), 2);
  });

  it("returns an empty map for no beats", () => {
    assert.equal(buildBeatIdIndex([]).size, 0);
  });

  it("keeps the last index when beats share an id", () => {
    const index = buildBeatIdIndex(beats("dup", "dup"));
    assert.equal(index.size, 1);
    assert.equal(index.get("dup"), 1);
  });
});
