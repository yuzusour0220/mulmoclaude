import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeAncestorDirs } from "../../src/composables/useFileTree.helpers.ts";

// Ancestor directory list a file's lazy-load walk iterates: shallowest
// first, EXCLUDING the file's own leaf, `[]` for a root-level file.

describe("computeAncestorDirs", () => {
  it("returns [] for the empty string", () => {
    assert.deepEqual(computeAncestorDirs(""), []);
  });

  it("returns [] for a single root-level segment (the file itself has no dir)", () => {
    assert.deepEqual(computeAncestorDirs("a"), []);
    assert.deepEqual(computeAncestorDirs("readme.md"), []);
  });

  it("returns the one parent dir for a file one level deep", () => {
    assert.deepEqual(computeAncestorDirs("a/b"), ["a"]);
  });

  it("returns every ancestor dir shallowest-first, excluding the leaf", () => {
    assert.deepEqual(computeAncestorDirs("a/b/c"), ["a", "a/b"]);
    assert.deepEqual(computeAncestorDirs("a/b/c/d.md"), ["a", "a/b", "a/b/c"]);
  });

  it("drops leading slashes as empty segments", () => {
    assert.deepEqual(computeAncestorDirs("/a/b"), ["a"]);
    assert.deepEqual(computeAncestorDirs("/a/b/c"), ["a", "a/b"]);
  });

  it("drops duplicate slashes as empty segments", () => {
    assert.deepEqual(computeAncestorDirs("a//b//c"), ["a", "a/b"]);
  });

  it("treats a slash-only path as having no real segments", () => {
    assert.deepEqual(computeAncestorDirs("/"), []);
    assert.deepEqual(computeAncestorDirs("///"), []);
  });
});
