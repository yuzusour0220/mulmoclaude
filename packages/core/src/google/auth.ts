// Google OAuth for the host machine, independent of Firebase Auth (which
// discards refresh tokens). Entry points:
//   - authorizeGoogle(): one-shot loopback + PKCE browser consent flow
//     (desktop-app clients may redirect to any 127.0.0.1 port), storing the
//     refresh token locally via tokenStore.
//   - getGoogleAccessToken(): mints a fresh access token from the stored
//     refresh token; the OAuth2Client "tokens" event persists rotations.
//   - unlinkGoogle(): best-effort revoke at Google + local token delete.
import { randomBytes } from "node:crypto";
import http from "node:http";
import { CodeChallengeMethod, OAuth2Client, type Credentials } from "google-auth-library";
import { log } from "./host.js";
import { errorMessage, ONE_MINUTE_MS, ONE_SECOND_MS } from "./util.js";
import { fetchWithTimeout } from "./fetch.js";
import { loadClientSecret, type InstalledClientSecret } from "./clientSecret.js";
import { deleteGoogleTokens, loadGoogleTokens, saveGoogleTokens } from "./tokenStore.js";

export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const GOOGLE_TASKS_SCOPE = "https://www.googleapis.com/auth/tasks";
export const GOOGLE_DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
/** Requested at consent as one set — matches the scopes registered on the
 *  OAuth consent screen, so a single re-link covers every supported API
 *  (Calendar now; Tasks / Drive tools ride the same grant later). */
export const GOOGLE_SCOPES = [GOOGLE_CALENDAR_SCOPE, GOOGLE_TASKS_SCOPE, GOOGLE_DRIVE_FILE_SCOPE];
const CALLBACK_PATH = "/oauth2callback";
const AUTH_TIMEOUT_MS = 5 * ONE_MINUTE_MS;
const STATE_BYTES = 16;

export interface AuthorizeGoogleOptions {
  home?: string;
  /** Called with the consent URL; open it in a browser (and/or print it). */
  onAuthUrl?: (url: string) => void;
  timeoutMs?: number;
}

const createClient = (secret: InstalledClientSecret, redirectUri?: string): OAuth2Client =>
  new OAuth2Client({ clientId: secret.client_id, clientSecret: secret.client_secret, redirectUri });

const persistRotatedTokens = (client: OAuth2Client, home?: string): void => {
  client.on("tokens", (tokens) => {
    saveGoogleTokens(tokens, home).catch((err: unknown) => {
      log.error("google", "failed to persist rotated tokens", { error: String(err) });
    });
  });
};

export async function getGoogleAccessToken(home?: string): Promise<string> {
  const saved = await loadGoogleTokens(home);
  if (!saved?.refresh_token) {
    // Host-neutral wording — this engine ships to multiple hosts whose link
    // flows differ (#2128); each host's own help carries the specific steps.
    throw new Error("Google account not linked on this host — ask the user to link their Google account in this app's settings, then retry");
  }
  const client = createClient(await loadClientSecret(home));
  client.setCredentials(saved);
  persistRotatedTokens(client, home);
  const { token } = await client.getAccessToken();
  if (!token) {
    throw new Error("could not obtain a Google access token — the grant may have been revoked; re-link the account");
  }
  return token;
}

const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/** The revoke POST, injectable for tests. */
export type RevokeFetch = typeof fetchWithTimeout;

/** Revoke the grant at Google (best-effort) and delete the local token file.
 *  Revoke failures are logged but never block the local delete — Google may
 *  already consider the token invalid, and keeping the file would leave the
 *  user unable to unlink. */
export async function unlinkGoogle(home?: string, revokeFetch: RevokeFetch = fetchWithTimeout): Promise<void> {
  const saved = await loadGoogleTokens(home);
  const token = saved?.refresh_token ?? saved?.access_token;
  if (token) {
    try {
      const response = await revokeFetch(REVOKE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }).toString(),
      });
      if (!response.ok) log.warn("google", "token revoke returned non-ok", { status: response.status });
    } catch (err) {
      log.warn("google", "token revoke failed, deleting local tokens anyway", { error: errorMessage(err) });
    }
  }
  await deleteGoogleTokens(home);
}

const startLoopbackServer = (): Promise<{ server: http.Server; port: number }> =>
  new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("loopback server has no port"));
        return;
      }
      resolve({ server, port: address.port });
    });
  });

// State is validated before error/code — a callback that can't prove it
// belongs to this flow must not influence it (its `error` text would
// otherwise reach the terminal attacker-controlled).
const authCodeFromCallback = (url: URL, expectedState: string): string => {
  if (url.searchParams.get("state") !== expectedState) throw new Error("OAuth state mismatch — possible CSRF, aborting");
  const error = url.searchParams.get("error");
  if (error) throw new Error(`Google authorization failed: ${error}`);
  const code = url.searchParams.get("code");
  if (!code) throw new Error("authorization callback carried no code");
  return code;
};

const respondHtml = (res: http.ServerResponse, status: number, message: string): void => {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<html><body><h3>${message}</h3></body></html>`);
};

export const waitForAuthCode = (server: http.Server, expectedState: string, timeoutMs: number): Promise<string> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`authorization timed out after ${timeoutMs / ONE_SECOND_MS}s`)), timeoutMs);
    server.on("request", (req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404);
        res.end();
        return;
      }
      // A wrong-state request is not our callback (drive-by localhost probe
      // or stale tab) — answer it but keep waiting for the real redirect, so
      // an unauthenticated request can't abort the pending flow.
      if (url.searchParams.get("state") !== expectedState) {
        respondHtml(res, 400, "Invalid authorization callback. You can close this tab.");
        return;
      }
      clearTimeout(timer);
      try {
        const code = authCodeFromCallback(url, expectedState);
        respondHtml(res, 200, "Authorization complete — you can close this tab.");
        resolve(code);
      } catch (err) {
        // Static text only — the failure detail echoes query-string content,
        // which must not be reflected into HTML. The CLI prints the detail.
        respondHtml(res, 400, "Authorization failed — see the terminal for details. You can close this tab.");
        reject(err);
      }
    });
  });

// `access_type: offline` + `prompt: consent` force Google to return a refresh
// token on every run (repeat consents otherwise omit it).
const buildConsentUrl = (client: OAuth2Client, codeChallenge: string, state: string): string =>
  client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_SCOPES,
    code_challenge_method: CodeChallengeMethod.S256,
    code_challenge: codeChallenge,
    state,
  });

export async function authorizeGoogle(opts: AuthorizeGoogleOptions = {}): Promise<Credentials> {
  const secret = await loadClientSecret(opts.home);
  const { server, port } = await startLoopbackServer();
  try {
    const client = createClient(secret, `http://127.0.0.1:${port}${CALLBACK_PATH}`);
    const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
    if (!codeChallenge) throw new Error("failed to derive a PKCE code challenge");
    const state = randomBytes(STATE_BYTES).toString("hex");
    opts.onAuthUrl?.(buildConsentUrl(client, codeChallenge, state));
    const code = await waitForAuthCode(server, state, opts.timeoutMs ?? AUTH_TIMEOUT_MS);
    const { tokens } = await client.getToken({ code, codeVerifier });
    if (!tokens.refresh_token) {
      throw new Error("Google returned no refresh token — remove this app under Google Account → Security → Third-party access, then retry");
    }
    return await saveGoogleTokens(tokens, opts.home);
  } finally {
    server.close();
  }
}
