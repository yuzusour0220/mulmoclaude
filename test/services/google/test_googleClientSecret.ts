// Unit tests for the client-secret loader: discovery by prefix in ~/.secrets
// and validation of the desktop-app ("installed") JSON shape.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { findClientSecretPath, loadClientSecret } from "../../../server/services/google/clientSecret.js";
import { googleSecretsDir } from "../../../server/services/google/paths.js";

const makeFakeHome = async (files: Record<string, string> = {}): Promise<string> => {
  const home = await mkdtemp(path.join(tmpdir(), "google-secret-test-"));
  const dir = googleSecretsDir(home);
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(dir, name), content, "utf-8");
  }
  return home;
};

const validSecret = JSON.stringify({ installed: { client_id: "id-123", client_secret: "secret-456", redirect_uris: ["http://localhost"] } });

describe("findClientSecretPath", () => {
  it("finds a client_secret_*.json by prefix", async () => {
    const home = await makeFakeHome({ "client_secret_abc.apps.googleusercontent.com.json": validSecret });
    assert.match(await findClientSecretPath(home), /client_secret_abc/);
  });

  it("ignores unrelated files in ~/.secrets", async () => {
    const home = await makeFakeHome({ "other-key.json": "{}", "client_secret_notes.txt": "nope" });
    await assert.rejects(findClientSecretPath(home), /no client_secret_\*\.json found/);
  });

  it("fails with guidance when ~/.secrets does not exist", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "google-secret-test-"));
    await assert.rejects(findClientSecretPath(home), /download the OAuth desktop-app credentials/);
  });
});

describe("loadClientSecret", () => {
  it("returns client_id and client_secret from the installed shape", async () => {
    const home = await makeFakeHome({ "client_secret_abc.json": validSecret });
    assert.deepEqual(await loadClientSecret(home), { client_id: "id-123", client_secret: "secret-456" });
  });

  it("rejects a web-app credential (no installed key)", async () => {
    const home = await makeFakeHome({ "client_secret_web.json": JSON.stringify({ web: { client_id: "x", client_secret: "y" } }) });
    await assert.rejects(loadClientSecret(home), /not a desktop-app OAuth client secret/);
  });

  it("rejects an installed shape missing client_secret", async () => {
    const home = await makeFakeHome({ "client_secret_partial.json": JSON.stringify({ installed: { client_id: "only-id" } }) });
    await assert.rejects(loadClientSecret(home), /not a desktop-app OAuth client secret/);
  });

  it("rejects malformed JSON", async () => {
    const home = await makeFakeHome({ "client_secret_broken.json": "{oops" });
    await assert.rejects(loadClientSecret(home), SyntaxError);
  });
});
