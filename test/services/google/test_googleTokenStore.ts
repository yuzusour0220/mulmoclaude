// Unit tests for the Google token store: merge semantics (refresh-token
// preservation) and the 600-mode file roundtrip against a fake home dir.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { googleTokenPath, loadGoogleTokens, mergeGoogleTokens, saveGoogleTokens } from "@mulmoclaude/core/google";

const makeFakeHome = async (): Promise<string> => await mkdtemp(path.join(tmpdir(), "google-token-test-"));

const POSIX_MODE_MASK = 0o777;

describe("mergeGoogleTokens", () => {
  it("keeps the stored refresh_token when a refresh response omits it", () => {
    const existing = { refresh_token: "keep-me", access_token: "old" };
    const incoming = { access_token: "new", expiry_date: 123 };
    assert.deepEqual(mergeGoogleTokens(existing, incoming), { refresh_token: "keep-me", access_token: "new", expiry_date: 123 });
  });

  it("keeps the stored refresh_token when the incoming one is null", () => {
    const merged = mergeGoogleTokens({ refresh_token: "keep-me" }, { refresh_token: null, access_token: "new" });
    assert.equal(merged.refresh_token, "keep-me");
  });

  it("adopts a newly issued refresh_token", () => {
    const merged = mergeGoogleTokens({ refresh_token: "old" }, { refresh_token: "rotated" });
    assert.equal(merged.refresh_token, "rotated");
  });

  it("works with no existing tokens", () => {
    assert.deepEqual(mergeGoogleTokens(null, { access_token: "a" }), { access_token: "a" });
  });

  it("returns the incoming shape for an empty incoming object", () => {
    assert.deepEqual(mergeGoogleTokens({ refresh_token: "keep-me" }, {}), { refresh_token: "keep-me" });
  });
});

describe("token file roundtrip", () => {
  it("returns null when no token file exists", async () => {
    const home = await makeFakeHome();
    assert.equal(await loadGoogleTokens(home), null);
  });

  it("saves and reloads tokens through the fake home", async () => {
    const home = await makeFakeHome();
    await saveGoogleTokens({ refresh_token: "r1", access_token: "a1" }, home);
    assert.deepEqual(await loadGoogleTokens(home), { refresh_token: "r1", access_token: "a1" });
  });

  it("merges on save so a token rotation cannot drop the refresh token", async () => {
    const home = await makeFakeHome();
    await saveGoogleTokens({ refresh_token: "r1", access_token: "a1" }, home);
    await saveGoogleTokens({ access_token: "a2", expiry_date: 42 }, home);
    assert.deepEqual(await loadGoogleTokens(home), { refresh_token: "r1", access_token: "a2", expiry_date: 42 });
  });

  it("writes the token file with mode 600", async (testContext) => {
    if (process.platform === "win32") {
      testContext.skip("POSIX file modes do not apply on Windows");
      return;
    }
    const home = await makeFakeHome();
    await saveGoogleTokens({ refresh_token: "r1" }, home);
    const tokenFileStat = await stat(googleTokenPath(home));
    assert.equal(tokenFileStat.mode & POSIX_MODE_MASK, 0o600);
  });

  it("returns null for a corrupted token file instead of throwing", async () => {
    const home = await makeFakeHome();
    await mkdir(path.dirname(googleTokenPath(home)), { recursive: true });
    await writeFile(googleTokenPath(home), "{not json", "utf-8");
    assert.equal(await loadGoogleTokens(home), null);
  });
});
