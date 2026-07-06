// Remote-host lifecycle: wire a Firebase session to the Firestore host runner so
// connecting starts the command loop + presence heartbeat, and disconnecting
// stops both.
//
// Extracted into core from MulmoClaude's server/remoteHost/index.ts. The factory
// takes injected collaborators — real hosts bind them to Firebase; tests pass
// fakes to exercise the invariants (non-destructive connect, serialized
// transitions, status/liveness reconciliation on fatal listener death) without a
// network. `hostId` and the logger are injected too, so this file imports no
// Firebase and no host logger and stays trivially unit-testable.
//
// Single-account, single-host per instance, in-memory session: a host restart
// drops the session and needs a re-connect.
import type { Channel, Command, CommandHandlers } from "../index.js";
import type { HostRunnerOptions } from "./hostRunner.js";

export interface RemoteHostStatus {
  connected: boolean;
  uid: string | null;
}

// Minimal logger the factory calls; each host adapts its own logger to this
// shape (or omits it to run silently, as the tests do).
export interface RemoteHostLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  debug: (msg: string) => void;
}

// Injectable collaborators — a real host binds these to Firebase + its own
// hostId; tests pass fakes to exercise the lifecycle without a network.
// `startRunner` is the host's `startHostRunner` pre-bound with its Firestore
// instance, so this module needs no Firebase of its own.
export interface RemoteHostDeps {
  hostId: string;
  signIn: (idToken: string) => Promise<string>;
  signOut: () => Promise<void>;
  currentUid: () => string | null;
  startRunner: (channel: Channel, handlers: CommandHandlers, options: HostRunnerOptions) => () => void;
  handlers: CommandHandlers;
  // Optional host-specific cleanup for a command the runner drops as expired
  // (e.g. delete its staged attachment uploads). Threaded verbatim into the
  // runner's `onExpire`; absent ⇒ an expired doc is just deleted.
  onExpire?: (command: Command) => void | Promise<void>;
  log?: RemoteHostLogger;
}

export interface RemoteHostLifecycle {
  connect: (idToken: string) => Promise<RemoteHostStatus>;
  disconnect: () => Promise<RemoteHostStatus>;
  status: () => RemoteHostStatus;
}

const noop = () => undefined;
const silentLogger: RemoteHostLogger = { info: noop, warn: noop, debug: noop };

export const createRemoteHost = (deps: RemoteHostDeps): RemoteHostLifecycle => {
  const log = deps.log ?? silentLogger;

  // The running host runner's stop() handle, or null when disconnected. Keeps
  // the single-host invariant — one runner at a time.
  let stopRunner: (() => void) | null = null;

  // Serialize connect/disconnect so overlapping requests can't both mutate
  // stopRunner (which would leak a second runner) or race auth against teardown.
  // Each transition runs only after the previous one settles; a failed
  // transition does not block the next (both handlers run the next op).
  let transition: Promise<unknown> = Promise.resolve();

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

  const status = (): RemoteHostStatus => ({ connected: stopRunner !== null, uid: deps.currentUid() });

  const startRunner = (uid: string) => {
    const runner = deps.startRunner({ uid, hostId: deps.hostId }, deps.handlers, {
      onEvent: (event) => log.debug(`host event: ${event.phase} ${event.method}`),
      onExpire: deps.onExpire,
      // The listener died fatally (heartbeat already stopped + offline written);
      // clear the handle so status() stops reporting connected — but only if it
      // still points at THIS runner (a later reconnect may have replaced it).
      onClosed: () => {
        if (stopRunner === runner) {
          stopRunner = null;
          log.warn("host runner listener died; marked disconnected");
        }
      },
    });
    return runner;
  };

  const connect = (idToken: string): Promise<RemoteHostStatus> =>
    serialize(async () => {
      // Authenticate BEFORE any teardown, so a failed connect (expired/rejected
      // token) leaves an existing healthy session untouched instead of dropping it.
      const uid = await deps.signIn(idToken);
      stopIfRunning();
      stopRunner = startRunner(uid);
      log.info(`connected as ${uid}, host runner started (hostId=${deps.hostId})`);
      return status();
    });

  const disconnect = (): Promise<RemoteHostStatus> =>
    serialize(async () => {
      stopIfRunning();
      await deps.signOut();
      log.info("disconnected, host runner stopped");
      return status();
    });

  return { connect, disconnect, status };
};
