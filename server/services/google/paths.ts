// Google OAuth material lives OUTSIDE the workspace: the client secret is
// machine-only (never synced) and the refresh token must survive workspace
// resets — same reasoning as the gcloud / gh CLI model. Mirrors the
// overridable-anchor pattern of `server/utils/claudeConfigPath.ts`; the
// `home` parameter exists so tests can thread a fake home directory.
import { homedir } from "node:os";
import { join } from "node:path";

export function googleConfigDir(home?: string): string {
  return join(home ?? homedir(), ".config", "mulmoclaude");
}

export function googleTokenPath(home?: string): string {
  return join(googleConfigDir(home), "google-token.json");
}

export function googleSecretsDir(home?: string): string {
  return join(home ?? homedir(), ".secrets");
}
