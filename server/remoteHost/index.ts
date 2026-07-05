// Remote-host lifecycle for this host: bind MulmoClaude's Firebase deps + hostId
// to the shared `createRemoteHost` factory so connecting from the toolbar starts
// the Firestore command loop + presence heartbeat, and disconnecting stops both.
//
// The transport engine (command loop, connect/disconnect invariants, Firebase
// init/auth) lives in `@mulmoclaude/core/remote-host/server`; this module only
// supplies host specifics — hostId, the handler table, the firestore-bound
// runner, and a logger adapter — and exposes the default singleton the route uses.
//
// Single-account, single-host (HOST_ID = "mulmoclaude"), in-memory session: a
// server restart drops the session and needs a re-connect.
import { createRemoteHost, startHostRunner } from "@mulmoclaude/core/remote-host/server";

import { log } from "../system/logger/index.js";
import { HOST_ID } from "./commandChannel.js";
import { currentUid, signInHost, signOutHost } from "./auth.js";
import { firestore } from "./firebase.js";
import { handlers } from "./handlers/index.js";

export type { RemoteHostStatus } from "@mulmoclaude/core/remote-host/server";

const PREFIX = "remote-host";

// Default singleton wired to the real Firebase deps — imported by the route. The
// runner is pre-bound with this host's firestore instance; the logger adapts the
// factory's plain-string calls to the host logger's (prefix, msg) shape.
const instance = createRemoteHost({
  hostId: HOST_ID,
  signIn: signInHost,
  signOut: signOutHost,
  currentUid,
  startRunner: (channel, hostHandlers, options) => startHostRunner(firestore, channel, hostHandlers, options),
  handlers,
  log: {
    info: (msg) => log.info(PREFIX, msg),
    warn: (msg) => log.warn(PREFIX, msg),
    debug: (msg) => log.debug(PREFIX, msg),
  },
});

export const { connect, disconnect, status } = instance;
