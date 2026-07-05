// Firebase credential exchange for this host's remote-host runner.
//
// The credential primitives (signInWithCredential as the user — Option B, no
// Admin SDK) live in the shared `@mulmoclaude/core/remote-host/server`; this
// module just binds them to this host's Firebase auth instance. The
// connect/disconnect lifecycle (which starts/stops the host runner) lives in
// index.ts.
import { createRemoteHostAuth } from "@mulmoclaude/core/remote-host/server";

import { auth } from "./firebase.js";

export const { signInHost, signOutHost, currentUid } = createRemoteHostAuth(auth);
