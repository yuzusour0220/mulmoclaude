import type { ToolDefinition } from "gui-chat-protocol";
import { META } from "./meta";
import type { ResolvedRoute } from "../meta-types";

export const TOOL_NAME = META.toolName;
export type PresentCollectionEndpoints = { readonly [K in keyof typeof META.apiRoutes]: ResolvedRoute };

export const TOOL_DEFINITION: ToolDefinition = {
  type: "function",
  name: META.toolName,
  description:
    "Display a schema-driven collection inline in the chat as an interactive, editable card. Shows the collection's list of records; the user can open a record for a detailed view and edit / create / delete records, with changes saved to the workspace. Pass `itemId` to open one specific record on mount. Use this when the user wants to see or work with a collection (e.g. clients, invoices, contacts) directly in the conversation rather than navigating away to the collections page.",
  parameters: {
    type: "object",
    properties: {
      collectionSlug: {
        type: "string",
        description: "The slug of the collection to display (e.g. 'clients', 'invoices', 'contacts').",
      },
      itemId: {
        type: "string",
        description: "Optional primary-key value of a single record to open in detail view on mount. Omit to show the full list.",
      },
    },
    required: ["collectionSlug"],
  },
};

export default TOOL_DEFINITION;
