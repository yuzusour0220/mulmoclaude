// Tests for `server/utils/launch-env.mjs` — the launcher's `.env`
// loader that lets `npx mulmoclaude` users keep secrets in the launch
// dir instead of the isolated ~/mulmoclaude workspace. (#2081.)

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseEnvFile, mergeLaunchEnv } from "../../server/utils/launch-env.mjs";

describe("launch-env parseEnvFile", () => {
  it("returns exists:false for a missing file (never throws)", () => {
    const result = parseEnvFile("/no/such/dir/.env");
    assert.deepEqual(result, { exists: false, parsed: {} });
  });

  it("returns exists:false when readFileSync throws (e.g. EACCES)", () => {
    const result = parseEnvFile("/x/.env", {
      readFileSync: () => {
        throw new Error("EACCES");
      },
    });
    assert.equal(result.exists, false);
    assert.deepEqual(result.parsed, {});
  });

  it("parses an existing file's contents", () => {
    const result = parseEnvFile("/x/.env", {
      readFileSync: () => "GEMINI_API_KEY=abc\nFOO=bar\n",
    });
    assert.equal(result.exists, true);
    assert.deepEqual(result.parsed, { GEMINI_API_KEY: "abc", FOO: "bar" });
  });

  it("honours an injected parse seam", () => {
    const result = parseEnvFile("/x/.env", {
      readFileSync: () => "raw",
      parse: (src) => ({ SRC: src }),
    });
    assert.deepEqual(result.parsed, { SRC: "raw" });
  });
});

describe("launch-env mergeLaunchEnv", () => {
  it("applies new keys from the file", () => {
    const { env, loadedKeys, skippedKeys } = mergeLaunchEnv({ PATH: "/usr/bin" }, { GEMINI_API_KEY: "abc" });
    assert.equal(env.GEMINI_API_KEY, "abc");
    assert.equal(env.PATH, "/usr/bin");
    assert.deepEqual(loadedKeys, ["GEMINI_API_KEY"]);
    assert.deepEqual(skippedKeys, []);
  });

  it("lets an exported shell var win over the file", () => {
    const { env, loadedKeys, skippedKeys } = mergeLaunchEnv({ GEMINI_API_KEY: "shell" }, { GEMINI_API_KEY: "file" });
    assert.equal(env.GEMINI_API_KEY, "shell");
    assert.deepEqual(loadedKeys, []);
    assert.deepEqual(skippedKeys, ["GEMINI_API_KEY"]);
  });

  it("treats a base key whose value is undefined as absent", () => {
    const { env, loadedKeys } = mergeLaunchEnv({ GEMINI_API_KEY: undefined }, { GEMINI_API_KEY: "file" });
    assert.equal(env.GEMINI_API_KEY, "file");
    assert.deepEqual(loadedKeys, ["GEMINI_API_KEY"]);
  });

  it("handles an empty parsed object", () => {
    const base = { PATH: "/usr/bin" };
    const { env, loadedKeys, skippedKeys } = mergeLaunchEnv(base, {});
    assert.deepEqual(env, base);
    assert.deepEqual(loadedKeys, []);
    assert.deepEqual(skippedKeys, []);
  });

  it("does not mutate the base env", () => {
    const base = { PATH: "/usr/bin" };
    mergeLaunchEnv(base, { FOO: "bar" });
    assert.deepEqual(base, { PATH: "/usr/bin" });
    assert.equal("FOO" in base, false);
  });

  it("partitions mixed new / shell-defined keys", () => {
    const { loadedKeys, skippedKeys } = mergeLaunchEnv({ A: "shell" }, { A: "file", B: "file" });
    assert.deepEqual(loadedKeys, ["B"]);
    assert.deepEqual(skippedKeys, ["A"]);
  });
});
