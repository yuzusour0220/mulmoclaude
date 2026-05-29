import { definePluginMeta } from "../meta-types";

export const META = definePluginMeta({
  toolName: "presentCollection",
  // Distinct from the host-owned `collections` REST namespace
  // (/api/collections/...) so the aggregator doesn't drop it as a
  // collision — this is only the MCP dispatch endpoint.
  apiNamespace: "presentCollection",
  apiRoutes: {
    /** POST /api/presentCollection — present a collection (or one
     *  item) inline in the chat. */
    dispatch: { method: "POST", path: "" },
  },
  mcpDispatch: "dispatch",
});
