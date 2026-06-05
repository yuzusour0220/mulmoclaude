import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveClientDir } from "../../../server/utils/clientDir.ts";

describe("resolveClientDir", () => {
  const DEFAULT_DIR = "/abs/repo/client";

  it("uses env value when non-empty", () => {
    assert.equal(resolveClientDir("/custom/client", DEFAULT_DIR), "/custom/client");
  });

  it("trims env value when non-empty", () => {
    assert.equal(resolveClientDir("  /custom/client  ", DEFAULT_DIR), "/custom/client");
  });

  it("uses env value when relative", () => {
    assert.equal(resolveClientDir("./client", DEFAULT_DIR), "./client");
  });

  it("falls back to default when env is undefined", () => {
    assert.equal(resolveClientDir(undefined, DEFAULT_DIR), DEFAULT_DIR);
  });

  it("falls back to default when env is empty string", () => {
    assert.equal(resolveClientDir("", DEFAULT_DIR), DEFAULT_DIR);
  });

  it("falls back to default when env is whitespace-only", () => {
    assert.equal(resolveClientDir("   ", DEFAULT_DIR), DEFAULT_DIR);
  });
});
