// Persistence for the Google OAuth tokens (refresh + access) at
// `~/.config/mulmo/google-token.json`, mode 600. Google omits
// `refresh_token` from refresh responses, so merges must preserve the one we
// already hold — losing it forces the user through the browser consent again.
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { Credentials } from "google-auth-library";
import { readJsonOrNull, writeJsonAtomicWithMode } from "./fsJson.js";
import { googleTokenPath, legacyGoogleTokenPath } from "./paths.js";

const TOKEN_FILE_MODE = 0o600;

export function mergeGoogleTokens(existing: Credentials | null, incoming: Credentials): Credentials {
  const merged = { ...existing, ...incoming };
  if (!incoming.refresh_token && existing?.refresh_token) merged.refresh_token = existing.refresh_token;
  return merged;
}

const fileExists = async (filePath: string): Promise<boolean> =>
  await stat(filePath).then(
    () => true,
    () => false,
  );

// Tokens written before 0.20.1 live under the mulmoclaude-branded dir; move
// them once (rename preserves mode 600). Best-effort — a failed migration
// must not block a fresh link, and when both files exist the new one wins
// (the legacy copy is left for any older install still reading it).
async function migrateLegacyTokenFile(home?: string): Promise<void> {
  const current = googleTokenPath(home);
  const legacy = legacyGoogleTokenPath(home);
  if ((await fileExists(current)) || !(await fileExists(legacy))) return;
  await mkdir(path.dirname(current), { recursive: true });
  await rename(legacy, current);
}

export async function loadGoogleTokens(home?: string): Promise<Credentials | null> {
  await migrateLegacyTokenFile(home).catch(() => undefined);
  return await readJsonOrNull<Credentials>(googleTokenPath(home));
}

export async function saveGoogleTokens(incoming: Credentials, home?: string): Promise<Credentials> {
  const merged = mergeGoogleTokens(await loadGoogleTokens(home), incoming);
  await writeJsonAtomicWithMode(googleTokenPath(home), merged, TOKEN_FILE_MODE);
  return merged;
}

export async function deleteGoogleTokens(home?: string): Promise<void> {
  await rm(googleTokenPath(home), { force: true });
}
