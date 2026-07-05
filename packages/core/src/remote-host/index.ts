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

// Per-host command queue: users/{uid}/hosts/{hostId}/commands.
export const commandsCollection = (firestore: Firestore, channel: Channel): CollectionReference<DocumentData> =>
  collection(firestore, "users", channel.uid, "hosts", channel.hostId, "commands");

// Presence doc for a host: users/{uid}/hosts/{hostId}. The host heartbeats
// { online, updatedAt } here; the remote reads it to know if the host is up.
export const hostDoc = (firestore: Firestore, channel: Channel): DocumentReference<DocumentData> =>
  doc(firestore, "users", channel.uid, "hosts", channel.hostId);
