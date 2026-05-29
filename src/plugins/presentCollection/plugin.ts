// Server-side execute for presentCollection. Pure / isomorphic (no Vue,
// no Node-only imports) — bundled to the browser via `index.ts` and run
// server-side via `server/api/routes/plugins.ts`.
//
// The executor only validates + echoes the addressing. The live
// collection schema + items are fetched client-side by `CollectionView`
// (via /api/collections/...), so a bad slug surfaces as the View's
// "not-found" state rather than a tool error.

import type { ToolContext, ToolResult } from "gui-chat-protocol";
import type { PresentCollectionArgs, PresentCollectionData } from "./types";

export { TOOL_NAME, TOOL_DEFINITION } from "./definition";

export const executePresentCollection = async (
  _context: ToolContext,
  args: PresentCollectionArgs,
): Promise<ToolResult<PresentCollectionData, PresentCollectionData>> => {
  const collectionSlug = typeof args?.collectionSlug === "string" ? args.collectionSlug.trim() : "";
  if (!collectionSlug) {
    return {
      message: "presentCollection error: collectionSlug is required",
      instructions: "Tell the user you couldn't display the collection because no collection was specified, and ask which collection they mean.",
    };
  }
  const itemId = typeof args.itemId === "string" && args.itemId.trim().length > 0 ? args.itemId.trim() : undefined;
  const data: PresentCollectionData = itemId ? { collectionSlug, itemId } : { collectionSlug };
  const target = itemId ? `${collectionSlug} / ${itemId}` : collectionSlug;
  return {
    message: `Presented collection ${target}`,
    // `data` is the view's source (also the host's render-eligibility
    // signal); `jsonData` is what the LLM sees. Same payload, two
    // audiences — keep both in sync.
    data,
    jsonData: data,
    instructions:
      "The collection has been presented to the user as an interactive card. They can browse, open, edit, create, and delete records directly. No further action is needed unless they ask.",
  };
};
