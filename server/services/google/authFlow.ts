// In-flight manager for the settings-UI OAuth flow. authorizeGoogle()
// resolves only after the user finishes the browser consent, so the HTTP
// layer starts it in the background, returns the consent URL immediately,
// and reports progress via status polling. One flow at a time — starting
// again while pending returns the same URL instead of spawning a second
// loopback listener.
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
  let pendingAuthUrl: string | null = null;
  let lastError: string | null = null;

  const start = async (): Promise<{ authUrl: string }> => {
    if (pendingAuthUrl) return { authUrl: pendingAuthUrl };
    lastError = null;
    const authUrl = await new Promise<string>((resolve, reject) => {
      authorize({
        onAuthUrl: (url) => {
          pendingAuthUrl = url;
          resolve(url);
        },
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
          pendingAuthUrl = null;
        });
    });
    return { authUrl };
  };

  const status = (): GoogleAuthFlowStatus => ({ pending: pendingAuthUrl !== null, lastError });

  return { start, status };
};

export const googleAuthFlow = createGoogleAuthFlow(authorizeGoogle);
