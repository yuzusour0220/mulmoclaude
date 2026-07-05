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
import { FirebaseApp, FirebaseOptions, initializeApp } from "firebase/app";
import { Auth, getAuth } from "firebase/auth";
import { Firestore, getFirestore } from "firebase/firestore";
import { FirebaseStorage, getStorage } from "firebase/storage";

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
