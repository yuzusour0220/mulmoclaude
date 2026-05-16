// Encore plugin registration — built-in, single MCP tool
// (`manageEncore`) + a transient click-handler View at `/encore`.
//
// The Vue View dispatches `resolveNotification` on mount and
// redirects to the seeded chat (Step 5). The MCP-side `execute`
// posts to /api/encore (apiNamespace from META) so the LLM-facing
// MCP bridge and any in-page dispatch share one server handler.
//
// See plans/feat-encore-as-builtin.md for the build plan and
// plans/feat-encore-plugin.md for the DSL spec / design decisions.

import type { ToolResult } from "gui-chat-protocol";
import type { PluginEntry, PluginRegistration, ToolPlugin } from "../../tools/types";
import { pluginEndpoints } from "../api";
import { wrapWithScope } from "../scope";
import { apiCall } from "../../utils/api";
import { makeUuid } from "../../utils/id";
import View from "./View.vue";
import definition, { TOOL_NAME } from "./definition";

export interface EncoreEndpoints {
  [key: string]: string;
  dispatch: string;
}

export interface EncoreData {
  kind?: string;
  ok?: boolean;
  message?: string;
  [key: string]: unknown;
}

const execute: ToolPlugin<EncoreData>["execute"] = async function execute(_context, args) {
  const endpoints = pluginEndpoints<{ dispatch: { method: string; url: string } }>("encore");
  const { method, url } = endpoints.dispatch;
  const result = await apiCall<ToolResult<EncoreData>>(url, { method: method as "POST", body: args });
  if (!result.ok) {
    return {
      toolName: TOOL_NAME,
      uuid: makeUuid(),
      message: result.error,
    };
  }
  return {
    ...result.data,
    toolName: TOOL_NAME,
    uuid: result.data.uuid ?? makeUuid(),
  };
};

export const manageEncorePlugin: ToolPlugin<EncoreData> = {
  toolDefinition: definition,
  execute,
  isEnabled: () => true,
  generatingMessage: "Updating Encore...",
  viewComponent: wrapWithScope("encore", View),
};

const encorePluginEntry: PluginEntry = manageEncorePlugin as unknown as PluginEntry;

export const REGISTRATION: PluginRegistration = {
  toolName: TOOL_NAME,
  entry: encorePluginEntry,
};

export default manageEncorePlugin;
