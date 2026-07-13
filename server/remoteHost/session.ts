// Firebase session for this host's remote-host runner, backed by the export/
// seed-able session controller in `@mulmoclaude/core/remote-host/server` so a
// server restart doesn't drop the session — the browser parks it in
// localStorage and hands it back on reconnect (case A', mulmoserver#50).
//
// The controller opens a FRESH Firebase app per (re)connect (initializeAuth
// reads persistence once), so `auth`/`firestore`/`storage` change each time.
// This module holds the current handles and exposes them as getters, so the
// runner, onExpire, and attachment ingest always target the live session's
// Firestore/Storage/uid rather than a stale module-level instance.
import { createRemoteHostAuth, createRemoteHostSession, type RemoteHostSessionHandles } from "@mulmoclaude/core/remote-host/server";
import type { Firestore } from "firebase/firestore";
import type { FirebaseStorage } from "firebase/storage";

import { firebaseConfig } from "../../src/config/firebaseConfig.js";

const session = createRemoteHostSession(firebaseConfig);
let handles: RemoteHostSessionHandles | null = null;

// Fresh connect: open a clean session and sign in as the user with the
// browser-minted Google OAuth ID token. Resolves to the authenticated uid.
export const signIn = async (idToken: string): Promise<string> => {
  handles = await session.open();
  return createRemoteHostAuth(handles.auth).signInHost(idToken);
};

// Popup-free reconnect: open the session seeded from the browser-parked blob and
// resolve to the restored uid. Rejects when the blob yields no valid session, so
// the lifecycle's reconnect stays non-destructive and the client falls back to a
// normal connect.
export const restore = async (blob: string): Promise<string> => {
  handles = await session.open(blob);
  if (!handles.uid) throw new Error("remote-host session could not be restored");
  return handles.uid;
};

export const signOut = async (): Promise<void> => {
  if (handles) await createRemoteHostAuth(handles.auth).signOutHost();
  await session.close();
  handles = null;
};

const requireHandles = (): RemoteHostSessionHandles => {
  if (!handles) throw new Error("remote-host session is not open");
  return handles;
};

export const currentUid = (): string | null => handles?.auth.currentUser?.uid ?? null;
export const currentFirestore = (): Firestore => requireHandles().firestore;
export const currentStorage = (): FirebaseStorage => requireHandles().storage;

// The blob the browser parks (refresh token included). Null when disconnected.
export const exportSession = (): string | null => session.exportSession();
