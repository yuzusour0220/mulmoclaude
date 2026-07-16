// Persistence for the Google OAuth tokens (refresh + access) at
// `~/.config/mulmoclaude/google-token.json`, mode 600. Google omits
// `refresh_token` from refresh responses, so merges must preserve the one we
// already hold — losing it forces the user through the browser consent again.
import { rm } from "node:fs/promises";
import type { Credentials } from "google-auth-library";
import { readJsonOrNull, writeJsonAtomic } from "../../utils/files/json.js";
import { googleTokenPath } from "./paths.js";

const TOKEN_FILE_MODE = 0o600;

export function mergeGoogleTokens(existing: Credentials | null, incoming: Credentials): Credentials {
  const merged = { ...existing, ...incoming };
  if (!incoming.refresh_token && existing?.refresh_token) merged.refresh_token = existing.refresh_token;
  return merged;
}

export async function loadGoogleTokens(home?: string): Promise<Credentials | null> {
  return await readJsonOrNull<Credentials>(googleTokenPath(home));
}

export async function saveGoogleTokens(incoming: Credentials, home?: string): Promise<Credentials> {
  const merged = mergeGoogleTokens(await loadGoogleTokens(home), incoming);
  await writeJsonAtomic(googleTokenPath(home), merged, { mode: TOKEN_FILE_MODE });
  return merged;
}

export async function deleteGoogleTokens(home?: string): Promise<void> {
  await rm(googleTokenPath(home), { force: true });
}
