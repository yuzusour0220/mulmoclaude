import type { PluginRegistration, ToolPlugin } from "../../tools/types";
import type { ToolResult } from "gui-chat-protocol";
import toolDefinition, { TOOL_NAME, type HtmlEndpoints } from "./definition";
import { pluginEndpoints } from "../api";
import { wrapWithScope } from "../scope";
import View from "./View.vue";
import Preview from "./Preview.vue";
import { apiCall } from "../../utils/api";
import { makeUuid } from "../../utils/id";
import type { PresentHtmlData } from "@mulmoclaude/html-plugin";

// Re-exported from the shared package so the View / Preview keep importing the
// result-data shape from "./index" while the type stays single-sourced.
export type { PresentHtmlData };

const presentHtmlPlugin: ToolPlugin<PresentHtmlData> = {
  toolDefinition,

  async execute(_context, args) {
    const endpoints = pluginEndpoints<HtmlEndpoints>("html");
    const { method, url } = endpoints.create;
    const result = await apiCall<ToolResult<PresentHtmlData>>(url, { method, body: args });
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
  generatingMessage: "Presenting HTML page…",
  viewComponent: wrapWithScope("html", View),
  previewComponent: wrapWithScope("html", Preview),
};

export default presentHtmlPlugin;
export { TOOL_NAME };

export const REGISTRATION: PluginRegistration = {
  toolName: TOOL_NAME,
  entry: presentHtmlPlugin,
};
