// Image ingest for remote chat attachments (plans/feat-remote-chat-image-attachments.md).
//
// The phone can't carry full-res photo bytes over the Firestore command channel
// (a command doc caps at ~1 MiB), so it uploads each photo to Firebase Storage
// at `users/{uid}/uploads/{storage_id}` and sends only the `storage_id` on
// startChat. This module — signed in as the same user — pulls each staged
// object, persists it into the workspace attachment store via `saveAttachment`
// (so it lands in `data/attachments/YYYY/MM/`, gets a correct mime, and is
// accepted by the same attachment pipeline Vue uploads use), deletes the
// Storage object (staging only), and returns a path-only `Attachment` per photo
// for startChat to hand to the spawned chat.
//
// Factory (createIngestImages) keeps the flow unit-testable with the Storage +
// attachment-store deps stubbed; the default export wires the real ones.
import { deleteObject, getBytes, getMetadata, ref } from "firebase/storage";
import type { Attachment } from "@mulmobridge/protocol";

import { saveAttachment } from "../../utils/files/attachment-store.js";
import { currentUid } from "../auth.js";
import { storage } from "../firebase.js";

// `storage_id` is a bare UUID minted by the remote (`crypto.randomUUID()`).
// Accept only a safe token so it can never reshape the Storage path (no `/`,
// no `..`) before it is interpolated into `users/{uid}/uploads/{storage_id}`.
const STORAGE_ID_RE = /^[A-Za-z0-9-]+$/;

// Belt-and-suspenders cap matching the remote's 20 MiB upload rule, so a
// mis-sized object can't balloon host memory on download.
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024;

export interface IngestDeps {
  uid: () => string | null;
  fetchObject: (storagePath: string) => Promise<{ base64: string; contentType: string }>;
  saveAttachment: (base64: string, mimeType: string) => Promise<{ relativePath: string; mimeType: string }>;
  deleteObject: (storagePath: string) => Promise<void>;
}

// storage_ids -> path-only Attachments, in order. Rejects the whole batch on the
// first failure (host not signed in, malformed id, or a download that fails):
// the remote already uploaded and is waiting on the result, so a surfaced error
// beats silently starting a chat with a missing photo. Each Storage object is
// deleted only after its bytes are safely in the workspace.
export const createIngestImages =
  (deps: IngestDeps) =>
  async (storageIds: string[]): Promise<Attachment[]> => {
    if (storageIds.length === 0) return [];
    const uid = deps.uid();
    if (!uid) throw new Error("remote host is not signed in");
    const attachments: Attachment[] = [];
    for (const storageId of storageIds) {
      if (!STORAGE_ID_RE.test(storageId)) throw new Error(`invalid storage_id: ${storageId}`);
      const storagePath = `users/${uid}/uploads/${storageId}`;
      const { base64, contentType } = await deps.fetchObject(storagePath);
      const saved = await deps.saveAttachment(base64, contentType);
      await deps.deleteObject(storagePath);
      attachments.push({ path: saved.relativePath, mimeType: saved.mimeType });
    }
    return attachments;
  };

// Pull an object's bytes + content type from Storage. `getBytes` (not the
// browser-only `getBlob`) returns an ArrayBuffer that works on the Node host.
const fetchObject = async (storagePath: string): Promise<{ base64: string; contentType: string }> => {
  const objectRef = ref(storage, storagePath);
  const [bytes, metadata] = await Promise.all([getBytes(objectRef, MAX_DOWNLOAD_BYTES), getMetadata(objectRef)]);
  return { base64: Buffer.from(bytes).toString("base64"), contentType: metadata.contentType ?? "application/octet-stream" };
};

export const ingestImages = createIngestImages({
  uid: currentUid,
  fetchObject,
  saveAttachment,
  deleteObject: (storagePath) => deleteObject(ref(storage, storagePath)),
});
