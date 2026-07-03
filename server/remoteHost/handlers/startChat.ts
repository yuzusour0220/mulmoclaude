// startChat command handler (remote-host — start a chat from the mobile remote).
//
// The remote sends text; the host starts a new VISIBLE chat session (origin
// `skill`, openable from desktop history) seeded with it, and returns the new
// chatId. Fire-and-forget: no streaming back — starting the chat on the host is
// enough.
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ THE CONTRACT — read this before touching the params.                      │
// │                                                                           │
// │ CURRENT clients send ONLY `{ message }`. The message is seeded VERBATIM   │
// │ as the first user turn. The host does NOT interpret it, so the client is  │
// │ free to put a slash command (`/<slug> …`), a plain question, or anything  │
// │ else in the text. This is the ONLY form new code should emit.             │
// │                                                                           │
// │ `slug` (and its optional companion `itemId`) is LEGACY-ONLY. Older        │
// │ clients still send `{ slug, itemId?, message }` to target a collection    │
// │ or one record; we keep composing `/<slug> [id=<itemId>] <message>` for    │
// │ them so they don't break. DO NOT add new features to this branch, and DO  │
// │ NOT teach new clients to send `slug` — put the slash command in           │
// │ `message` instead. The whole legacy path can be deleted once no deployed  │
// │ client sends `slug` anymore.                                              │
// └─────────────────────────────────────────────────────────────────────────┘
//
// Role is intentionally NOT part of the remote API — the host runs the chat in
// its default role (spawnSystemWorker → startChat requires a concrete roleId;
// empty is rejected).
//
// Optional `attachments` — full-res files (photos, videos, PDFs) the remote
// staged to Storage, carried as `[{ storage_id }]`. The host ingests them into
// the workspace (ingestAttachments) and hands the resulting path-only
// Attachments to the spawned chat. Absent / empty ⇒ byte-for-byte the prior
// text-only behaviour.
//
// Factory (createStartChat) keeps composition/wiring unit-testable with the
// engine + spawner stubbed; the default export wires the real ones.
import { spawnSystemWorker } from "../../api/routes/agent.js";
import { loadCollection } from "../../workspace/collections/index.js";
import { DEFAULT_ROLE_ID } from "../../../src/config/roles.js";
import type { CommandHandler, JsonObject, JsonValue } from "../commandChannel.js";
import { ingestAttachments } from "./ingestAttachments.js";

export interface StartChatDeps {
  spawn: typeof spawnSystemWorker;
  loadCollection: typeof loadCollection;
  ingest: typeof ingestAttachments;
}

// Parse the optional `attachments` param into a list of storage_ids. Absent ⇒ no
// attachments. A malformed shape (not an array, or an element without a string
// `storage_id`) rejects the whole command: the remote already uploaded the
// bytes and is waiting, so a surfaced error beats a chat with a missing file.
const readStorageIds = (attachments: JsonValue | undefined): string[] => {
  if (attachments == null) return [];
  if (!Array.isArray(attachments)) throw new Error("attachments must be an array of { storage_id }");
  return attachments.map((entry) => {
    const storageId = entry && typeof entry === "object" && !Array.isArray(entry) ? entry.storage_id : undefined;
    if (typeof storageId !== "string" || storageId.length === 0) throw new Error("each attachments entry must be { storage_id: string }");
    return storageId;
  });
};

// LEGACY. Prefix the message with the collection's slash command. `itemId`
// scopes the chat to one record; empty ⇒ the whole collection. Matches the
// desktop item-chat format documented in CollectionRecordPanel.vue. Only the
// legacy `slug` path calls this — new clients put the slash command in
// `message` themselves.
export const composeMessage = (slug: string, itemId: string, message: string): string => {
  const prefix = itemId ? `/${slug} id=${itemId}` : `/${slug}`;
  return `${prefix} ${message}`;
};

// LEGACY. slug and itemId become single tokens in the slash command
// (`/<slug>`, `id=<itemId>`), so a whitespace-containing or non-string value
// would break the command parse (e.g. `/   hello`). Accept only a trimmed,
// whitespace-free string; anything else ⇒ "" so the caller rejects it.
const asToken = (value: JsonValue): string => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return /\s/.test(trimmed) ? "" : trimmed;
};

// LEGACY collection/record targeting for older clients that still send `slug`.
// Compose the `/<slug> [id=<itemId>] <message>` seed the desktop uses; reject a
// malformed or unknown slug and refuse feeds, so we never seed a `/<slug>`
// command that resolves to nothing. New clients skip all of this by sending the
// slash command (or plain text) in `message`.
const composeCollectionSeed = async (deps: StartChatDeps, params: JsonObject, message: string): Promise<string> => {
  const slug = asToken(params.slug);
  const itemId = asToken(params.itemId);
  if (!slug) throw new Error("slug must be a non-empty, whitespace-free string");
  if (params.itemId != null && !itemId) throw new Error("itemId must be a non-empty, whitespace-free string when provided");
  const target = await deps.loadCollection(slug);
  if (!target) throw new Error(`collection '${slug}' not found`);
  if (target.source === "feed") throw new Error("chat is not available for feeds");
  return composeMessage(slug, itemId, message);
};

// A `slug` is "provided" (⇒ LEGACY targeting) only when it is a non-empty
// value. Omitted / null / "" ⇒ the current free-text form. New clients never
// set it, so they always take the verbatim branch below.
const hasSlug = (value: JsonValue | undefined): boolean => value != null && value !== "";

export const createStartChat =
  (deps: StartChatDeps): CommandHandler =>
  async (params: JsonObject) => {
    // Params arrive as JSON over the channel — coerce/validate defensively.
    const message = (typeof params.message === "string" ? params.message : "").trim();
    if (!message) throw new Error("message is required");
    // Current clients: `message` only ⇒ seed it verbatim. Legacy clients that
    // still send `slug` ⇒ compose the old `/<slug> [id=<itemId>] <message>` seed.
    const seed = hasSlug(params.slug) ? await composeCollectionSeed(deps, params, message) : message;
    // Ingest any staged files BEFORE spawning so a download/validation failure
    // rejects the command instead of starting a chat missing its attachments.
    const attachments = await deps.ingest(readStorageIds(params.attachments));
    const result = await deps.spawn({ message: seed, roleId: DEFAULT_ROLE_ID, hidden: false, attachments });
    if (!result.ok) throw new Error(result.error);
    return { started: true, chatId: result.chatId };
  };

export const startChat = createStartChat({ spawn: spawnSystemWorker, loadCollection, ingest: ingestAttachments });
