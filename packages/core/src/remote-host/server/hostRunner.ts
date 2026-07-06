// Host side of the command channel: claim queued commands, run handlers, write
// results back, and announce presence via heartbeat.
//
// Extracted into core from MulmoClaude's server/remoteHost/hostRunner.ts (itself
// ported from ../mulmoserver). The only signature change vs. that copy: the
// `firestore` instance is a parameter (each host supplies its own Firebase init),
// and the heartbeat interval is an option (defaults to one minute).
import { DocumentReference, Firestore, onSnapshot, query, runTransaction, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";

import { errorMessage } from "../../collection/core/errorMessage.js";
import { Channel, Command, CommandHandler, CommandHandlers, JsonObject, buildHostPresence, commandsCollection, hostDoc } from "../index.js";

const DEFAULT_HEARTBEAT_MS = 60_000;

export interface HostEvent {
  phase: "received" | "done" | "error";
  method: string;
  message?: string;
}

export interface HostRunnerOptions {
  onEvent?: (event: HostEvent) => void;
  // Called once when the listener dies fatally (after presence has been set
  // offline), so the lifecycle owner can reconcile its own state — e.g. clear
  // the runner handle so status() no longer reports connected. NOT called on a
  // normal stop().
  onClosed?: () => void;
  // Presence heartbeat interval; defaults to one minute.
  heartbeatMs?: number;
}

interface Claim {
  method: string;
  params: JsonObject;
}

const noop = () => undefined;

// The remote may have deleted the doc on timeout, so ignore write-after-delete.
const writeError = (ref: DocumentReference, code: string, message: string) =>
  updateDoc(ref, { status: "error", error: { code, message }, updatedAt: serverTimestamp() }).catch(noop);

// Atomically move a command queued -> processing so it is handled exactly once.
// Returns the method/params to run, or null if another handler already took it.
const claimCommand = (firestore: Firestore, ref: DocumentReference): Promise<Claim | null> =>
  runTransaction(firestore, async (txn) => {
    const data = (await txn.get(ref)).data() as Command | undefined;
    if (!data || data.status !== "queued") {
      return null;
    }
    txn.update(ref, { status: "processing", updatedAt: serverTimestamp() });
    return { method: data.method, params: data.params ?? {} };
  });

const runHandler = async (ref: DocumentReference, claim: Claim, handler: CommandHandler): Promise<HostEvent> => {
  try {
    const result = await handler(claim.params);
    await updateDoc(ref, { status: "done", result: result ?? null, updatedAt: serverTimestamp() });
    return { phase: "done", method: claim.method };
  } catch (error) {
    const message = errorMessage(error);
    await writeError(ref, "handler_error", message);
    return { phase: "error", method: claim.method, message };
  }
};

const processCommand = async (firestore: Firestore, ref: DocumentReference, handlers: CommandHandlers, onEvent?: HostRunnerOptions["onEvent"]) => {
  const claim = await claimCommand(firestore, ref);
  if (!claim) {
    return;
  }
  onEvent?.({ phase: "received", method: claim.method });
  const handler: CommandHandler | undefined = handlers[claim.method];
  if (!handler) {
    await writeError(ref, "unknown_method", `No handler for method: ${claim.method}`);
    onEvent?.({ phase: "error", method: claim.method, message: "unknown method" });
    return;
  }
  onEvent?.(await runHandler(ref, claim, handler));
};

// startHostRunner subscribes to queued commands for the given channel and runs
// each one through the supplied handler table. It also announces presence (a
// heartbeat on users/{uid}/hosts/{hostId}) so the remote can tell it is online.
// Returns a stop function that goes offline and detaches the listener.
export const startHostRunner = (firestore: Firestore, channel: Channel, handlers: CommandHandlers, options: HostRunnerOptions = {}): (() => void) => {
  const presence = hostDoc(firestore, channel);
  // Advertise online/offline + the capability set (method names + protocol
  // version) on the same doc the remote already listens to for presence.
  const writePresence = (online: boolean) => setDoc(presence, { ...buildHostPresence(channel, handlers, online), updatedAt: serverTimestamp() }).catch(noop);
  const announce = () => {
    writePresence(true);
  };
  announce();
  const beat = setInterval(announce, options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS);

  const queuedCommands = query(commandsCollection(firestore, channel), where("status", "==", "queued"));
  const unsubscribe = onSnapshot(
    queuedCommands,
    (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === "added") {
          processCommand(firestore, change.doc.ref, handlers, options.onEvent).catch(noop);
        }
      });
    },
    (error) => {
      options.onEvent?.({ phase: "error", method: "listen", message: error.message });
      // A Firestore onSnapshot error terminates the listener and it does not
      // recover on its own. Stop advertising presence (clear the heartbeat +
      // write online:false) so remotes see the host as offline instead of a
      // live host that silently consumes no commands.
      clearInterval(beat);
      writePresence(false);
      options.onClosed?.();
    },
  );

  return () => {
    clearInterval(beat);
    writePresence(false);
    unsubscribe();
  };
};
