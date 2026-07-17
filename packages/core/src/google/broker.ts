// Client for the mulmoserver OAuth broker (receptron/mulmoserver#54).
//
// Why a broker: Google requires a client_secret at the token endpoint even for
// PKCE flows, so a user without their own Cloud project cannot complete a link
// on their own. The broker holds the secret and applies it — it never stores or
// returns it, and tokens still live only on this machine.
//
// What proves this host started the flow is the PKCE code_verifier: anyone can
// mint a `state` at /googleOAuthStart, so the verifier — not the state — is the
// authorization. See the broker's pkce.ts for the same reasoning server-side.
import type { Credentials } from "google-auth-library";
import { fetchWithTimeout } from "./fetch.js";
import { errorMessage, isRecord, ONE_SECOND_MS } from "./util.js";

const DEFAULT_BROKER_BASE_URL = "https://asia-northeast1-mulmoserver.cloudfunctions.net";
const BROKER_TIMEOUT_MS = 20 * ONE_SECOND_MS;

// Trailing slashes are stripped by hand: `/\/+$/` backtracks super-linearly on
// a long run of slashes, which lint rejects.
const withoutTrailingSlashes = (url: string): string => {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end -= 1;
  return url.slice(0, end);
};

/** `MULMO_GOOGLE_BROKER_URL` lets a fork / staging deploy point elsewhere
 *  without a code change; unset means the shipped broker. */
export const brokerBaseUrl = (override: string | undefined = process.env.MULMO_GOOGLE_BROKER_URL): string =>
  withoutTrailingSlashes(override ?? DEFAULT_BROKER_BASE_URL);

export interface BrokerStartResponse {
  authUrl: string;
  state: string;
}

const brokerFetch = async (url: string, init: { method?: string; body?: string } = {}): Promise<unknown> => {
  let response: Response;
  try {
    response = await fetchWithTimeout(url, {
      ...init,
      timeoutMs: BROKER_TIMEOUT_MS,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    throw new Error(`Google sign-in service unreachable — check the network connection and retry (${errorMessage(err)})`);
  }
  if (!response.ok) {
    // The broker answers deliberately opaque errors (it must not help probe
    // codes / refresh tokens), so there is nothing more specific to surface.
    throw new Error(`Google sign-in service returned HTTP ${response.status}`);
  }
  return await response.json();
};

export async function brokerStart(port: number, codeChallenge: string, baseUrl = brokerBaseUrl()): Promise<BrokerStartResponse> {
  const params = new URLSearchParams({ port: String(port), code_challenge: codeChallenge });
  const payload = await brokerFetch(`${baseUrl}/googleOAuthStart?${params.toString()}`);
  const record = isRecord(payload) ? payload : {};
  if (typeof record.auth_url !== "string" || typeof record.state !== "string") {
    throw new Error("Google sign-in service returned an unexpected response (missing auth_url / state)");
  }
  return { authUrl: record.auth_url, state: record.state };
}

const toCredentials = (payload: unknown, existingRefreshToken?: string): Credentials => {
  const record = isRecord(payload) ? payload : {};
  if (typeof record.access_token !== "string") {
    throw new Error("Google sign-in service returned no access token");
  }
  // The refresh endpoint does not echo the refresh_token back — keep the one we
  // already hold so a renewal can't silently unlink the account.
  const refreshToken = typeof record.refresh_token === "string" ? record.refresh_token : existingRefreshToken;
  return {
    access_token: record.access_token,
    ...(refreshToken ? { refresh_token: refreshToken } : {}),
    ...(typeof record.expiry_date === "number" ? { expiry_date: record.expiry_date } : {}),
  };
};

export async function brokerExchange(input: { code: string; state: string; codeVerifier: string }, baseUrl = brokerBaseUrl()): Promise<Credentials> {
  const payload = await brokerFetch(`${baseUrl}/googleOAuthExchange`, {
    method: "POST",
    body: JSON.stringify({ code: input.code, state: input.state, code_verifier: input.codeVerifier }),
  });
  const credentials = toCredentials(payload);
  if (!credentials.refresh_token) {
    throw new Error("Google returned no refresh token — remove this app under Google Account → Security → Third-party access, then retry");
  }
  return credentials;
}

export async function brokerRefresh(refreshToken: string, baseUrl = brokerBaseUrl()): Promise<Credentials> {
  const payload = await brokerFetch(`${baseUrl}/googleOAuthRefresh`, {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  return toCredentials(payload, refreshToken);
}
