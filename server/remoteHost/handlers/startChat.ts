// startChat command handler (remote-host — start a chat from the mobile remote).
//
// Fire-and-forget: composes the collection's slash command as a prefix on the
// user's message (`/<slug> <message>` for a collection, `/<slug> id=<itemId>
// <message>` for one record), then spawns a VISIBLE host chat session (origin
// `skill`, openable from history) via spawnSystemWorker, and returns the new
// chatId. No streaming back — starting the chat on the host is enough.
//
// Mirrors the desktop's two entry points over the command channel: the
// collection-level `__MC_VIEW.startChat` and the per-record chat box in
// CollectionRecordPanel.vue (`/<slug> id=<itemId> <message>`).
//
// Role is intentionally NOT part of the remote API — the caller passes only
// message + slug + optional itemId. The host runs the chat in its default role
// (spawnSystemWorker → startChat requires a concrete roleId; empty is rejected).
//
// Factory (createStartChat) keeps composition/wiring unit-testable with the
// spawner stubbed; the default export wires the real spawnSystemWorker.
import { spawnSystemWorker } from "../../api/routes/agent.js";
import { DEFAULT_ROLE_ID } from "../../../src/config/roles.js";
import type { CommandHandler, JsonObject, JsonValue } from "../commandChannel.js";

export interface StartChatDeps {
  spawn: typeof spawnSystemWorker;
}

// Prefix the message with the collection's slash command. `itemId` scopes the
// chat to one record; empty ⇒ the whole collection. Matches the desktop
// item-chat format documented in CollectionRecordPanel.vue.
export const composeMessage = (slug: string, itemId: string, message: string): string => {
  const prefix = itemId ? `/${slug} id=${itemId}` : `/${slug}`;
  return `${prefix} ${message}`;
};

// slug and itemId become single tokens in the slash command (`/<slug>`,
// `id=<itemId>`), so a whitespace-containing or non-string value would break
// the command parse (e.g. `/   hello`). Accept only a trimmed, whitespace-free
// string; anything else ⇒ "" so the caller rejects it.
const asToken = (value: JsonValue): string => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return /\s/.test(trimmed) ? "" : trimmed;
};

export const createStartChat =
  (deps: StartChatDeps): CommandHandler =>
  async (params: JsonObject) => {
    // Params arrive as JSON over the channel — coerce/validate defensively.
    const slug = asToken(params.slug);
    const itemId = asToken(params.itemId);
    const message = (typeof params.message === "string" ? params.message : "").trim();
    if (!slug) throw new Error("slug must be a non-empty, whitespace-free string");
    if (params.itemId != null && !itemId) throw new Error("itemId must be a non-empty, whitespace-free string when provided");
    if (!message) throw new Error("message is required");
    const result = await deps.spawn({
      message: composeMessage(slug, itemId, message),
      roleId: DEFAULT_ROLE_ID,
      hidden: false,
    });
    if (!result.ok) throw new Error(result.error);
    return { started: true, chatId: result.chatId };
  };

export const startChat = createStartChat({ spawn: spawnSystemWorker });
