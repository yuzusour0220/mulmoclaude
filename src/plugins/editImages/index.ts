import type { PluginRegistration, ToolPlugin } from "../../tools/types";
import type { ToolResult } from "gui-chat-protocol";
import toolDefinition, { TOOL_NAME, type ImageEndpoints, type ImageToolData } from "./definition";
import { pluginEndpoints } from "../api";
import { wrapWithScope } from "../scope";
import View from "./View.vue";
import Preview from "./Preview.vue";
import { apiPost } from "../../utils/api";
import { makeUuid } from "../../utils/id";

const editImagesPlugin: ToolPlugin<ImageToolData> = {
  toolDefinition,

  async execute(_context, args) {
    const endpoints = pluginEndpoints<ImageEndpoints>("image");
    const result = await apiPost<ToolResult<ImageToolData>>(endpoints.edit, args);
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
  generatingMessage: "Editing images...",
  viewComponent: wrapWithScope("image", View),
  previewComponent: wrapWithScope("image", Preview),
};
export { TOOL_NAME };

export const REGISTRATION: PluginRegistration = {
  toolName: TOOL_NAME,
  entry: editImagesPlugin,
};
