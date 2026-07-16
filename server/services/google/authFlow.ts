// In-flight manager for the settings-UI OAuth flow. authorizeGoogle()
// resolves only after the user finishes the browser consent, so the HTTP
// layer starts it in the background, returns the consent URL immediately,
// and reports progress via status polling. One flow at a time — the guard
// is the in-flight start promise itself (set synchronously before any
// await), so concurrent authorize requests share one flow instead of
// spawning parallel loopback listeners.
import { log } from "../../system/logger/index.js";
import { errorMessage } from "../../utils/errors.js";
import { authorizeGoogle } from "./auth.js";

export interface GoogleAuthFlowStatus {
  pending: boolean;
  lastError: string | null;
}

export interface GoogleAuthFlow {
  start: () => Promise<{ authUrl: string }>;
  status: () => GoogleAuthFlowStatus;
}

export const createGoogleAuthFlow = (authorize: typeof authorizeGoogle): GoogleAuthFlow => {
  let inFlightStart: Promise<{ authUrl: string }> | null = null;
  let flowRunning = false;
  let lastError: string | null = null;

  const launchFlow = (): Promise<{ authUrl: string }> =>
    new Promise((resolve, reject) => {
      flowRunning = true;
      authorize({
        onAuthUrl: (url) => resolve({ authUrl: url }),
      })
        .then(() => log.info("google", "authorize flow completed"))
        .catch((err: unknown) => {
          lastError = errorMessage(err);
          log.warn("google", "authorize flow failed", { error: lastError });
          // No-op when the URL already resolved; covers pre-URL failures
          // (missing client secret, port bind error).
          reject(err instanceof Error ? err : new Error(String(err)));
        })
        .finally(() => {
          flowRunning = false;
          inFlightStart = null;
        });
    });

  const start = (): Promise<{ authUrl: string }> => {
    if (inFlightStart) return inFlightStart;
    lastError = null;
    inFlightStart = launchFlow();
    return inFlightStart;
  };

  const status = (): GoogleAuthFlowStatus => ({ pending: flowRunning, lastError });

  return { start, status };
};

export const googleAuthFlow = createGoogleAuthFlow(authorizeGoogle);
