// Firebase init for a remote-host runner.
//
// A host acts as a *host*: it signs in to Firebase as the user (via
// signInWithCredential, see auth.ts) and listens to that user's command queue in
// Firestore. The modular firebase/firestore + firebase/auth SDKs run in Node, so
// this mirrors a browser init but also exposes Firestore (default database,
// which must be in Native mode) and Storage.
//
// Extracted into core from MulmoClaude's server/remoteHost/firebase.ts. The
// public web config is a parameter so each host supplies its own (both hosts
// reuse the shared mulmoserver project).
import { deleteApp, FirebaseApp, FirebaseOptions, initializeApp } from "firebase/app";
import { Auth, getAuth, initializeAuth } from "firebase/auth";
import { Firestore, getFirestore } from "firebase/firestore";
import { FirebaseStorage, getStorage } from "firebase/storage";

import { createHostSessionPersistence, type HostSessionPersistence } from "./sessionPersistence.js";

export interface RemoteHostFirebase {
  app: FirebaseApp;
  auth: Auth;
  firestore: Firestore;
  // Storage carries the full-res attachment bytes the command channel can't (a
  // Firestore command doc caps at ~1 MiB). The host, signed in as the user,
  // pulls each staged upload from `users/{uid}/uploads/{id}` and deletes it
  // after ingest.
  storage: FirebaseStorage;
}

export const createRemoteHostFirebase = (config: FirebaseOptions): RemoteHostFirebase => {
  const app = initializeApp(config);
  return { app, auth: getAuth(app), firestore: getFirestore(app), storage: getStorage(app) };
};

export interface RemoteHostSessionHandles {
  auth: Auth;
  firestore: Firestore;
  storage: FirebaseStorage;
  // The signed-in uid restored from a seed blob, or null when opened fresh
  // (before `signInHost`) or when the blob held no valid session.
  uid: string | null;
}

// A restartable Firebase session for a host, backed by the export/seed-able
// persistence (mulmoserver#50, "case A'"). Because `initializeAuth` reads
// persistence once and can run only once per app, each `open` spins up a FRESH
// app (unique name) with the persistence seeded first, then tears down the
// previous app — so a reconnect can restore a browser-parked session, and a
// fresh connect starts clean. `exportSession`/`onSessionChange` expose the blob
// the browser stores and the signal to re-sync it.
export interface RemoteHostSession {
  open: (seedBlob?: string) => Promise<RemoteHostSessionHandles>;
  close: () => Promise<void>;
  exportSession: () => string | null;
  onSessionChange: (cb: (blob: string | null) => void) => () => void;
}

// Build a fresh app from the (already seeded) persistence and wait for the
// restored auth state to settle. Persistence restore is async, so `uid`
// reflects a seeded session only after `authStateReady()` (null when the blob
// was empty/invalid, or on a fresh connect before `signInHost`).
const openFreshApp = async (
  config: FirebaseOptions,
  store: HostSessionPersistence,
  name: string,
): Promise<{ app: FirebaseApp; handles: RemoteHostSessionHandles }> => {
  // `initializeApp` registers the app in the SDK's global registry, so if init
  // then throws we must delete it — otherwise repeated reconnect failures leak
  // a registered app each time.
  const app = initializeApp(config, name);
  try {
    const auth = initializeAuth(app, { persistence: store.persistence });
    await auth.authStateReady();
    return { app, handles: { auth, firestore: getFirestore(app), storage: getStorage(app), uid: auth.currentUser?.uid ?? null } };
  } catch (error) {
    await deleteApp(app).catch(() => undefined);
    throw error;
  }
};

export const createRemoteHostSession = (config: FirebaseOptions): RemoteHostSession => {
  const store = createHostSessionPersistence();
  let app: FirebaseApp | null = null;
  let appSeq = 0;

  const close = async (): Promise<void> => {
    const previous = app;
    app = null;
    store.clear();
    if (previous) await deleteApp(previous);
  };

  const open = async (seedBlob?: string): Promise<RemoteHostSessionHandles> => {
    // Non-destructive: keep the current session intact until the fresh app is
    // proven to come up. A bad seed blob or a failed init must not tear down a
    // healthy session — the reconnect contract (mulmoserver#50). So we tear the
    // previous app down only AFTER success, and roll the store back on failure.
    const previousApp = app;
    const previousBlob = store.exportBlob();
    appSeq += 1;
    try {
      store.clear();
      if (seedBlob) store.seed(seedBlob);
      const { app: nextApp, handles } = await openFreshApp(config, store, `remote-host-${appSeq}`);
      app = nextApp;
      if (previousApp) await deleteApp(previousApp).catch(() => undefined);
      return handles;
    } catch (error) {
      store.clear();
      if (previousBlob) store.seed(previousBlob);
      throw error;
    }
  };

  return { open, close, exportSession: store.exportBlob, onSessionChange: store.onChange };
};
