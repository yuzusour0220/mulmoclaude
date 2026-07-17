import type { PluginRegistration, ToolPlugin } from "../../tools/types";
import type { ToolResult } from "gui-chat-protocol";
import type { MulmoScript } from "mulmocast";
import toolDefinition, { TOOL_NAME, type MulmoScriptEndpoints } from "./definition";
import { pluginEndpoints } from "../api";
import { wrapWithScope } from "../scope";
import View from "./View.vue";
import Preview from "./Preview.vue";
import { apiCall } from "../../utils/api";
import { makeUuid } from "../../utils/id";

export interface MulmoScriptData {
  script: MulmoScript;
  filePath: string;
}

const presentMulmoScriptPlugin: ToolPlugin<MulmoScriptData> = {
  toolDefinition,

  // Pass-through: the agent (MCP) and GUI dispatcher both end up at the
  // same backend route, which dispatches between create-new (`script`)
  // and reopen-existing (`filePath`) modes and handles the optional
  // `autoGenerateMovie` background trigger server-side. Keeping this
  // function trivial means the two callers can never drift apart.
  async execute(_context, args) {
    const endpoints = pluginEndpoints<MulmoScriptEndpoints>("mulmoScript");
    const { method, url } = endpoints.save;
    const result = await apiCall<ToolResult<MulmoScriptData>>(url, { method, body: args });
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
      uuid: makeUuid(),
    };
  },

  isEnabled: () => true,
  generatingMessage: "Generating MulmoScript storyboard…",
  viewComponent: wrapWithScope("mulmoScript", View),
  previewComponent: wrapWithScope("mulmoScript", Preview),
};

export const REGISTRATION: PluginRegistration = {
  toolName: TOOL_NAME,
  entry: presentMulmoScriptPlugin,
};
