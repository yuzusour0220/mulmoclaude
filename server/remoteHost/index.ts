// Remote-host lifecycle: wire the Firebase session (auth.ts) to the Firestore
// host runner (hostRunner.ts) so that connecting from the toolbar starts the
// command loop + presence heartbeat, and disconnecting stops both.
//
// Single-account, single-host (HOST_ID = "mulmoclaude"), in-memory session:
// a server restart drops the session and needs a re-connect (phase-1 default).
import { log } from "../system/logger/index.js";
import { HOST_ID } from "./commandChannel.js";
import { currentUid, signInHost, signOutHost } from "./auth.js";
import { handlers } from "./handlers/index.js";
import { startHostRunner } from "./hostRunner.js";

const PREFIX = "remote-host";

export interface RemoteHostStatus {
  connected: boolean;
  uid: string | null;
}

// The running host runner's stop() handle, or null when disconnected. Holding
// it here (module scope) makes connect/disconnect idempotent and keeps the
// single-host invariant — one runner at a time.
let stopRunner: (() => void) | null = null;

const stopIfRunning = () => {
  if (stopRunner) {
    stopRunner();
    stopRunner = null;
  }
};

export const status = (): RemoteHostStatus => ({ connected: stopRunner !== null, uid: currentUid() });

/**
 * Connect: sign in with the browser-minted Google ID token, then start the host
 * runner (command loop + presence heartbeat). Reconnecting stops any existing
 * runner first so there is never more than one. Returns the resulting status.
 */
export const connect = async (idToken: string): Promise<RemoteHostStatus> => {
  stopIfRunning();
  const uid = await signInHost(idToken);
  stopRunner = startHostRunner({ uid, hostId: HOST_ID }, handlers, {
    onEvent: (event) => log.debug(PREFIX, `host event: ${event.phase} ${event.method}`, { event }),
  });
  log.info(PREFIX, `connected as ${uid}, host runner started (hostId=${HOST_ID})`);
  return status();
};

/** Disconnect: stop the runner (writes online:false + detaches), then signOut. */
export const disconnect = async (): Promise<RemoteHostStatus> => {
  stopIfRunning();
  await signOutHost();
  log.info(PREFIX, "disconnected, host runner stopped");
  return status();
};
