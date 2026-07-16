// HTTP routes for the local Google account link (settings UI).
//
//   GET  /api/google/status     → { linked, pending, clientSecretFound, lastError }
//   POST /api/google/authorize  → { authUrl }  (starts the loopback + PKCE flow)
//   POST /api/google/unlink     → { linked: false }
//
// The consent happens in the user's browser against Google; the loopback
// listener binds on this host, so the browser must run on the same machine
// (`yarn google:auth` covers remote setups). Bearer-guarded like every /api
// route; tokens never appear in any response or log.
import { Router, Request, Response } from "express";

import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { unlinkGoogle } from "../../services/google/auth.js";
import { googleAuthFlow } from "../../services/google/authFlow.js";
import { hasClientSecret } from "../../services/google/clientSecret.js";
import { loadGoogleTokens } from "../../services/google/tokenStore.js";
import { errorMessage } from "../../utils/errors.js";
import { serverError } from "../../utils/httpError.js";
import { log } from "../../system/logger/index.js";

const PREFIX = "google";
const router = Router();

interface GoogleStatusResponse {
  linked: boolean;
  pending: boolean;
  clientSecretFound: boolean;
  lastError: string | null;
}

router.get(API_ROUTES.google.status, async (_req: Request, res: Response<GoogleStatusResponse>) => {
  try {
    const [tokens, clientSecretFound] = await Promise.all([loadGoogleTokens(), hasClientSecret()]);
    const flow = googleAuthFlow.status();
    res.json({ linked: Boolean(tokens?.refresh_token), pending: flow.pending, clientSecretFound, lastError: flow.lastError });
  } catch (err) {
    serverError(res, errorMessage(err, "google status failed"));
  }
});

router.post(API_ROUTES.google.authorize, async (_req: Request, res: Response<{ authUrl: string }>) => {
  try {
    res.json(await googleAuthFlow.start());
  } catch (err) {
    log.warn(PREFIX, "authorize start failed", { error: errorMessage(err) });
    serverError(res, errorMessage(err, "google authorize failed"));
  }
});

router.post(API_ROUTES.google.unlink, async (_req: Request, res: Response<{ linked: boolean }>) => {
  try {
    await unlinkGoogle();
    res.json({ linked: false });
  } catch (err) {
    log.warn(PREFIX, "unlink failed", { error: errorMessage(err) });
    serverError(res, errorMessage(err, "google unlink failed"));
  }
});

export default router;
