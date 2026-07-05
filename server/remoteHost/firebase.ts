// Node-side Firebase init for this host's remote-host runner.
//
// The init itself (initializeApp + getAuth/getFirestore/getStorage) lives in the
// shared `@mulmoclaude/core/remote-host/server` so both hosts share one copy;
// this module just supplies MulmoClaude's public web config. Firestore is the
// default database and must be in Native mode. Storage carries the full-res
// attachment bytes the command channel can't (see handlers/ingestAttachments.ts).
import { createRemoteHostFirebase } from "@mulmoclaude/core/remote-host/server";

import { firebaseConfig } from "../../src/config/firebaseConfig.js";

export const { app: firebaseApp, auth, firestore, storage } = createRemoteHostFirebase(firebaseConfig);
