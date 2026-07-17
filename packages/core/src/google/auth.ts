// Google OAuth for the host machine, independent of Firebase Auth (which
// discards refresh tokens). Two ways to reach a linked account:
//
//   - LOCAL: the user dropped their own desktop-app client JSON in
//     `~/.secrets/`. Everything (consent, exchange, refresh) happens on this
//     machine — nothing but Google is contacted.
//   - BROKER (the default): no client JSON, so the mulmoserver broker applies
//     the client secret for the exchange / refresh it cannot be done without.
//     Tokens still only ever live here. See broker.ts.
//
// Either way the loopback listener, the PKCE verifier, and the token file are
// this machine's. `issuedVia` on the stored token records which path minted it
// so renewals take the matching one.
import { randomBytes } from "node:crypto";
import http from "node:http";
import { CodeChallengeMethod, OAuth2Client, type Credentials } from "google-auth-library";
import { brokerExchange, brokerRefresh, brokerStart } from "./broker.js";
import { log } from "./host.js";
import { errorMessage, ONE_MINUTE_MS, ONE_SECOND_MS } from "./util.js";
import { fetchWithTimeout } from "./fetch.js";
import { clientSecretPresence, loadClientSecret, type InstalledClientSecret } from "./clientSecret.js";
import { deleteGoogleTokens, loadGoogleTokens, saveGoogleTokens, type IssuedVia } from "./tokenStore.js";

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
/** Renew a minute early so a call can't start with a token that expires
 *  mid-flight. */
const EXPIRY_MARGIN_MS = ONE_MINUTE_MS;

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

const REVOKED_GRANT_MESSAGE = "could not obtain a Google access token — the grant may have been revoked; re-link the account";

const localAccessToken = async (saved: Credentials, home?: string): Promise<string> => {
  // The saved token is bound to the client_id that minted it, so a link made
  // with a since-removed desktop client cannot be renewed by anything else —
  // including the broker. Re-linking is the only way out; say so, rather than
  // letting the loader's "no desktop client" wording imply a setup problem.
  if ((await clientSecretPresence(home)) !== "found") {
    throw new Error(
      "the saved Google link was created with an OAuth client that is no longer configured on this host — ask the user to link their Google account again in this app's settings",
    );
  }
  const client = createClient(await loadClientSecret(home));
  client.setCredentials(saved);
  persistRotatedTokens(client, home);
  const { token } = await client.getAccessToken();
  if (!token) throw new Error(REVOKED_GRANT_MESSAGE);
  return token;
};

// The broker mints access tokens because only it holds the client secret. The
// refreshed token is written back so the next call can reuse it until expiry
// instead of hitting the broker every time.
const brokerAccessToken = async (saved: Credentials, home?: string): Promise<string> => {
  if (typeof saved.expiry_date === "number" && saved.access_token && saved.expiry_date - EXPIRY_MARGIN_MS > Date.now()) {
    return saved.access_token;
  }
  const refreshed = await brokerRefresh(saved.refresh_token ?? "");
  if (!refreshed.access_token) throw new Error(REVOKED_GRANT_MESSAGE);
  await saveGoogleTokens(refreshed, home);
  return refreshed.access_token;
};

export async function getGoogleAccessToken(home?: string): Promise<string> {
  const saved = await loadGoogleTokens(home);
  if (!saved?.refresh_token) {
    // Host-neutral wording — this engine ships to multiple hosts whose link
    // flows differ (#2128); each host's own help carries the specific steps.
    throw new Error("Google account not linked on this host — ask the user to link their Google account in this app's settings, then retry");
  }
  // Tokens written before the broker existed carry no marker; they were all
  // minted from a local client, so that stays the default.
  return saved.issuedVia === "broker" ? await brokerAccessToken(saved, home) : await localAccessToken(saved, home);
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

// PKCE material is generated by an OAuth2Client with no credentials — the
// helper is pure crypto, and in broker mode there is no client to construct.
const generatePkce = async (): Promise<{ codeVerifier: string; codeChallenge: string }> => {
  const { codeVerifier, codeChallenge } = await new OAuth2Client().generateCodeVerifierAsync();
  if (!codeChallenge) throw new Error("failed to derive a PKCE code challenge");
  return { codeVerifier, codeChallenge };
};

const authorizeWithLocalClient = async (
  secret: InstalledClientSecret,
  server: http.Server,
  port: number,
  opts: AuthorizeGoogleOptions,
): Promise<Credentials> => {
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
  return tokens;
};

// The broker signs `state` with a key it never releases, so it — not this
// host — builds the authorization URL. `state` then round-trips through the
// browser and comes back to our loopback, where waitForAuthCode matches it.
const authorizeWithBroker = async (server: http.Server, port: number, opts: AuthorizeGoogleOptions): Promise<Credentials> => {
  const { codeVerifier, codeChallenge } = await generatePkce();
  const { authUrl, state } = await brokerStart(port, codeChallenge);
  opts.onAuthUrl?.(authUrl);
  const code = await waitForAuthCode(server, state, opts.timeoutMs ?? AUTH_TIMEOUT_MS);
  return await brokerExchange({ code, state, codeVerifier });
};

export async function authorizeGoogle(opts: AuthorizeGoogleOptions = {}): Promise<Credentials> {
  // A user-supplied client wins: it keeps the whole flow on this machine, and
  // silently preferring the broker would ignore a deliberate setup. Two of
  // them is unresolvable rather than a reason to fall back — the user meant to
  // use one of theirs, and a broker link would quietly not be it.
  const presence = await clientSecretPresence(opts.home);
  if (presence === "ambiguous") {
    // Same wording the loader raises, so the CLI and the settings UI (which
    // disables linking in this state) agree on the fix.
    await loadClientSecret(opts.home);
  }
  const useLocalClient = presence === "found";
  const { server, port } = await startLoopbackServer();
  try {
    const issuedVia: IssuedVia = useLocalClient ? "local" : "broker";
    const tokens = useLocalClient
      ? await authorizeWithLocalClient(await loadClientSecret(opts.home), server, port, opts)
      : await authorizeWithBroker(server, port, opts);
    return await saveGoogleTokens({ ...tokens, issuedVia }, opts.home);
  } finally {
    server.close();
  }
}
