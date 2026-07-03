// Node-side Firebase init for the remote-host runner.
//
// The MulmoClaude server acts as a *host*: it signs in to Firebase as the user
// (via signInWithCredential, see auth.ts) and listens to that user's command
// queue in Firestore. The modular firebase/firestore + firebase/auth SDKs run
// in Node, so this mirrors the browser init but also exposes Firestore (default
// database, which must be in Native mode).
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

import { firebaseConfig } from "../../src/config/firebaseConfig.js";

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const firestore = getFirestore(firebaseApp);
// Storage carries the full-res photo bytes the command channel can't (a
// Firestore command doc caps at ~1 MiB). The host, signed in as the user, pulls
// each staged upload from `users/{uid}/uploads/{id}` and deletes it after
// ingest — see handlers/ingestImages.ts.
export const storage = getStorage(firebaseApp);
