// Loads the Google OAuth desktop-app client credentials the user downloaded
// from the Cloud Console into `~/.secrets/client_secret_*.json`. The file is
// discovered by prefix so the user doesn't have to rename Google's long
// default filename.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { isRecord } from "../../utils/types.js";
import { googleSecretsDir } from "./paths.js";

export interface InstalledClientSecret {
  client_id: string;
  client_secret: string;
}

const isInstalledClientSecret = (value: unknown): value is { installed: InstalledClientSecret } => {
  if (!isRecord(value) || !isRecord(value.installed)) return false;
  return typeof value.installed.client_id === "string" && typeof value.installed.client_secret === "string";
};

export async function findClientSecretPath(home?: string): Promise<string> {
  const dir = googleSecretsDir(home);
  const entries = await readdir(dir).catch((): string[] => []);
  const matches = entries.filter((name) => name.startsWith("client_secret_") && name.endsWith(".json")).sort();
  const [first, ...rest] = matches;
  if (!first) {
    throw new Error(
      `no client_secret_*.json found in ${dir} — download the OAuth desktop-app credentials JSON from the Google Cloud Console and place it there (mode 600)`,
    );
  }
  if (rest.length > 0) {
    // The stored refresh token is bound to one client_id; silently picking one
    // of several files could pair the token with the wrong client
    // (invalid_grant), so ambiguity is an error the user must resolve.
    throw new Error(`multiple client_secret_*.json files found in ${dir} (${matches.join(", ")}) — keep exactly one`);
  }
  return join(dir, first);
}

export async function hasClientSecret(home?: string): Promise<boolean> {
  return await findClientSecretPath(home).then(
    () => true,
    () => false,
  );
}

export async function loadClientSecret(home?: string): Promise<InstalledClientSecret> {
  const filePath = await findClientSecretPath(home);
  const raw = await readFile(filePath, "utf-8");
  const parsed: unknown = JSON.parse(raw);
  if (!isInstalledClientSecret(parsed)) {
    throw new Error(`${filePath} is not a desktop-app OAuth client secret (missing "installed" with client_id / client_secret)`);
  }
  return { client_id: parsed.installed.client_id, client_secret: parsed.installed.client_secret };
}
