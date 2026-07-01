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
// it here (module scope) keeps the single-host invariant — one runner at a time.
let stopRunner: (() => void) | null = null;

// Serialize connect/disconnect so overlapping requests can't both mutate
// stopRunner (which would leak a second runner) or race auth against teardown.
// Each transition runs only after the previous one settles; a failed transition
// does not block the next (both handlers run the next op).
let transition: Promise<unknown> = Promise.resolve();

const noop = () => undefined;

const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
  const next = transition.then(operation, operation);
  transition = next.then(noop, noop);
  return next;
};

const stopIfRunning = () => {
  if (stopRunner) {
    stopRunner();
    stopRunner = null;
  }
};

export const status = (): RemoteHostStatus => ({ connected: stopRunner !== null, uid: currentUid() });

/**
 * Connect: sign in with the browser-minted Google ID token, THEN start the host
 * runner (command loop + presence heartbeat). Authentication happens before any
 * teardown, so a failed connect (expired token, rejected credential) leaves an
 * existing healthy session untouched rather than dropping it. Serialized against
 * concurrent connect/disconnect. Returns the resulting status.
 */
export const connect = (idToken: string): Promise<RemoteHostStatus> =>
  serialize(async () => {
    const uid = await signInHost(idToken);
    stopIfRunning();
    stopRunner = startHostRunner({ uid, hostId: HOST_ID }, handlers, {
      onEvent: (event) => log.debug(PREFIX, `host event: ${event.phase} ${event.method}`, { event }),
    });
    log.info(PREFIX, `connected as ${uid}, host runner started (hostId=${HOST_ID})`);
    return status();
  });

/** Disconnect: stop the runner (writes online:false + detaches), then signOut. */
export const disconnect = (): Promise<RemoteHostStatus> =>
  serialize(async () => {
    stopIfRunning();
    await signOutHost();
    log.info(PREFIX, "disconnected, host runner stopped");
    return status();
  });
