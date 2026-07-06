// Remote-host command-channel protocol — the browser-safe contract shared by a
// host (MulmoClaude, MulmoTerminal) and the remote/mobile client (mulmoserver).
//
// A host signs in to Firebase as the user, listens to that user's per-host
// command queue in Firestore, runs a handler, and writes the result back; the
// remote writes commands and reads results via a real-time listener. This module
// owns the wire types + the Firestore path helpers. It is the single source of
// truth so the host runner and the client never drift on the protocol.
//
// Ported from ../mulmoserver/src/firestore/commandChannel.ts and the per-host
// copy that lived in MulmoClaude's server/remoteHost/. The one change vs. those
// copies: the path helpers take the `firestore` instance as a parameter (rather
// than importing a module-level singleton) so a single extracted module serves
// every host's own Firebase init. The hostId is host-specific ("mulmoclaude",
// "mulmoterminal") and is supplied by each host — there is no discovery.
import { CollectionReference, DocumentData, DocumentReference, Firestore, collection, doc } from "firebase/firestore";

// JSON payloads carried by the command channel. Explicit JSON types keep the
// channel typed without resorting to any/unknown.
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = Record<string, JsonValue>;

// A channel routes commands to one specific host. Both sides agree on a
// hardcoded hostId per use case (e.g. "mulmoclaude", "mulmoterminal"); there is
// no discovery — the remote and host just share the id.
export interface Channel {
  uid: string;
  hostId: string;
}

export type CommandStatus = "queued" | "processing" | "done" | "error";

export interface CommandError {
  code: string;
  message: string;
}

// One document in a channel's commands subcollection is one API-call-like
// request. The remote (mobile) writes method/params; the host writes
// result/error/status.
export interface Command {
  method: string;
  params: JsonObject;
  status: CommandStatus;
  result: JsonValue;
  error: CommandError | null;
  createdBy: "remote" | "host";
}

export type CommandHandler = (params: JsonObject) => JsonValue | Promise<JsonValue>;
export type CommandHandlers = Record<string, CommandHandler>;

// Bumped when the command-channel wire protocol changes in a way the remote must
// gate on. Advertised in the presence doc so the remote can check compatibility
// before issuing commands.
export const REMOTE_HOST_PROTOCOL_VERSION = 1;

// The presence doc's payload: online flag + a capability advertisement. Written
// by the host on every heartbeat; the remote reads it from the presence listener
// it already runs (no extra round trip, known the instant the host is online).
// Browser-safe so the mobile client compiles against the same shape.
// `updatedAt` (a Firestore serverTimestamp) is added by the runner at write time
// and is intentionally not part of this capability contract.
export interface HostPresence {
  online: boolean;
  hostId: string;
  protocolVersion: number;
  // Method names the host serves — the keys of the live handler table.
  capabilities: string[];
}

// Build the presence payload from the live handler table. Capabilities are
// `Object.keys(handlers)` so registering a handler is the ONLY step needed to
// advertise it — there is no second list to keep in sync.
export const buildHostPresence = (channel: Channel, handlers: CommandHandlers, online: boolean): HostPresence => ({
  online,
  hostId: channel.hostId,
  protocolVersion: REMOTE_HOST_PROTOCOL_VERSION,
  capabilities: Object.keys(handlers),
});

// Per-host command queue: users/{uid}/hosts/{hostId}/commands.
export const commandsCollection = (firestore: Firestore, channel: Channel): CollectionReference<DocumentData> =>
  collection(firestore, "users", channel.uid, "hosts", channel.hostId, "commands");

// Presence doc for a host: users/{uid}/hosts/{hostId}. The host heartbeats
// { online, updatedAt } here; the remote reads it to know if the host is up.
export const hostDoc = (firestore: Firestore, channel: Channel): DocumentReference<DocumentData> =>
  doc(firestore, "users", channel.uid, "hosts", channel.hostId);
