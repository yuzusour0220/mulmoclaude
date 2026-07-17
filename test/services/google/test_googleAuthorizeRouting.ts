// Which client authorizeGoogle picks, per ~/.secrets state. The flows
// themselves need a browser, so these assert the decision only — the point is
// that `ambiguous` fails fast instead of silently linking via the broker
// (which would ignore the user's deliberate setup).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { authorizeGoogle, clientSecretPresence, googleSecretsDir } from "@mulmoclaude/core/google";

const desktopSecret = JSON.stringify({ installed: { client_id: "id-123", client_secret: "secret-456" } });

const makeFakeHome = async (files: Record<string, string> = {}): Promise<string> => {
  const home = await mkdtemp(path.join(tmpdir(), "google-authorize-test-"));
  const dir = googleSecretsDir(home);
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(dir, name), content, "utf-8");
  }
  return home;
};

describe("authorizeGoogle client routing", () => {
  it("refuses to link when two desktop clients are present", async () => {
    const home = await makeFakeHome({ "client_secret_a.json": desktopSecret, "client_secret_b.json": desktopSecret });
    assert.equal(await clientSecretPresence(home), "ambiguous");
    // Rejects before any consent URL is issued — the user has to resolve the
    // ambiguity, not get quietly linked through the broker.
    let issuedUrl: string | null = null;
    await assert.rejects(authorizeGoogle({ home, onAuthUrl: (url) => (issuedUrl = url), timeoutMs: 1_000 }), /multiple desktop-app client_secret/);
    assert.equal(issuedUrl, null);
  });
});
