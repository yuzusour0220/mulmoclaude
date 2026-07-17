import type { PluginRegistration, ToolPlugin } from "../../tools/types";
import type { ToolResult } from "gui-chat-protocol";
import toolDefinition, { TOOL_NAME, type SpreadsheetEndpoints, type SpreadsheetToolData } from "./definition";
import { pluginEndpoints } from "../api";
import { wrapWithScope } from "../scope";
import View from "./View.vue";
import Preview from "./Preview.vue";
import { apiCall } from "../../utils/api";
import { makeUuid } from "../../utils/id";

const spreadsheetPlugin: ToolPlugin<SpreadsheetToolData> = {
  toolDefinition,

  async execute(_context, args) {
    const endpoints = pluginEndpoints<SpreadsheetEndpoints>("spreadsheet");
    const { method, url } = endpoints.create;
    const result = await apiCall<ToolResult<SpreadsheetToolData>>(url, { method, body: args });
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
  generatingMessage: "Creating spreadsheet...",
  viewComponent: wrapWithScope("spreadsheet", View),
  previewComponent: wrapWithScope("spreadsheet", Preview),
};
export { TOOL_NAME };

export const REGISTRATION: PluginRegistration = {
  toolName: TOOL_NAME,
  entry: spreadsheetPlugin,
};
