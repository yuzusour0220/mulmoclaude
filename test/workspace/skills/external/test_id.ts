import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { deriveActiveId, deriveRepoId, parseGitHubHttpsUrl, urlCacheKey } from "../../../../server/workspace/skills/external/id.js";

describe("parseGitHubHttpsUrl", () => {
  it("parses a canonical https URL", () => {
    assert.deepEqual(parseGitHubHttpsUrl("https://github.com/anthropics/skills"), { owner: "anthropics", repo: "skills" });
  });

  it("accepts a trailing `.git`", () => {
    assert.deepEqual(parseGitHubHttpsUrl("https://github.com/anthropics/skills.git"), { owner: "anthropics", repo: "skills" });
  });

  it("accepts a trailing slash", () => {
    assert.deepEqual(parseGitHubHttpsUrl("https://github.com/anthropics/skills/"), { owner: "anthropics", repo: "skills" });
  });

  it("accepts dots and underscores in repo names", () => {
    assert.deepEqual(parseGitHubHttpsUrl("https://github.com/foo/bar.baz_qux"), { owner: "foo", repo: "bar.baz_qux" });
  });

  it("rejects http (not https)", () => {
    assert.equal(parseGitHubHttpsUrl("http://github.com/foo/bar"), null);
  });

  it("rejects non-github hosts", () => {
    assert.equal(parseGitHubHttpsUrl("https://gitlab.com/foo/bar"), null);
    assert.equal(parseGitHubHttpsUrl("https://example.com/foo/bar"), null);
  });

  it("rejects subpath-bearing URLs (caller passes subpath separately)", () => {
    assert.equal(parseGitHubHttpsUrl("https://github.com/anthropics/skills/tree/main/skills/foo"), null);
  });

  it("rejects malformed owner/repo (path-traversal shapes)", () => {
    assert.equal(parseGitHubHttpsUrl("https://github.com/../etc"), null);
    assert.equal(parseGitHubHttpsUrl("https://github.com/owner"), null);
    assert.equal(parseGitHubHttpsUrl("https://github.com//bar"), null);
  });
});

describe("deriveRepoId", () => {
  it("composes owner-repo from a valid URL", () => {
    assert.equal(deriveRepoId("https://github.com/anthropics/skills"), "anthropics-skills");
  });

  it("lowercases mixed-case input", () => {
    assert.equal(deriveRepoId("https://github.com/Foo-Bar/Cool-Repo"), "foo-bar-cool-repo");
  });

  it("collapses punctuation in the repo name", () => {
    assert.equal(deriveRepoId("https://github.com/foo/bar.baz_qux"), "foo-bar-baz-qux");
  });

  it("returns null on malformed URL", () => {
    assert.equal(deriveRepoId("not a url"), null);
    assert.equal(deriveRepoId("ssh://git@github.com/foo/bar"), null);
  });
});

describe("deriveActiveId", () => {
  it("uses owner-skillFolder when a skillFolder is given", () => {
    assert.equal(deriveActiveId("https://github.com/anthropics/skills", "pdf-form-filler"), "anthropics-pdf-form-filler");
  });

  it("falls back to owner-repo when skillFolder is null (single-skill-at-root repos)", () => {
    assert.equal(deriveActiveId("https://github.com/foo/cool-skill", null), "foo-cool-skill");
  });

  it("rejects path-traversal skillFolders", () => {
    assert.equal(deriveActiveId("https://github.com/foo/bar", ".."), null);
    assert.equal(deriveActiveId("https://github.com/foo/bar", "../etc"), null);
    assert.equal(deriveActiveId("https://github.com/foo/bar", "a/b"), null);
  });

  it("rejects skillFolders that collapse to an empty slug", () => {
    assert.equal(deriveActiveId("https://github.com/foo/bar", "..."), null);
    assert.equal(deriveActiveId("https://github.com/foo/bar", "---"), null);
  });

  it("rejects when URL itself is invalid", () => {
    assert.equal(deriveActiveId("not a url", "skill"), null);
  });

  it("lowercases mixed-case skillFolders", () => {
    assert.equal(deriveActiveId("https://github.com/foo/bar", "PdfFormFiller"), "foo-pdfformfiller");
  });
});

describe("urlCacheKey", () => {
  it("returns a stable hex string", () => {
    const key = urlCacheKey("https://github.com/anthropics/skills");
    assert.equal(typeof key, "string");
    assert.match(key, /^[a-f0-9]+$/);
    assert.equal(key.length, 16);
  });

  it("is deterministic", () => {
    assert.equal(urlCacheKey("https://github.com/foo/bar"), urlCacheKey("https://github.com/foo/bar"));
  });

  it("differs by URL", () => {
    assert.notEqual(urlCacheKey("https://github.com/foo/bar"), urlCacheKey("https://github.com/foo/baz"));
  });
});
