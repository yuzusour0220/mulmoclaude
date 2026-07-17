import type { ToolResult } from "gui-chat-protocol";
import type { PluginRegistration, ToolPlugin } from "../../tools/types";
import toolDefinition, { TOOL_NAME } from "./definition";
import type { ImageToolData } from "./definition";
import { pluginEndpoints } from "../api";
import { wrapWithScope } from "../scope";
import type { ImageEndpoints } from "../editImages/definition";
import View from "./View.vue";
import Preview from "./Preview.vue";
import { apiPost } from "../../utils/api";
import { makeUuid } from "../../utils/id";

function createUploadedImageResult(imageData: string, fileName: string, prompt: string): ToolResult<ImageToolData, never> {
  return {
    toolName: TOOL_NAME,
    data: { imageData, prompt },
    message: "",
    title: fileName,
  };
}

const generateImagePlugin: ToolPlugin<ImageToolData> = {
  toolDefinition,

  async execute(_context, args) {
    const endpoints = pluginEndpoints<ImageEndpoints>("image");
    const result = await apiPost<ToolResult<ImageToolData>>(endpoints.generate, args);
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
  generatingMessage: "Generating image...",
  inputHandlers: [
    {
      type: "file",
      acceptedTypes: ["image/png", "image/jpeg"],
      handleInput: (fileData: string, fileName: string) => createUploadedImageResult(fileData, fileName, ""),
    },
    {
      type: "clipboard-image",
      handleInput: (imageData: string) => createUploadedImageResult(imageData, "clipboard-image.png", ""),
    },
  ],
  viewComponent: wrapWithScope("image", View),
  previewComponent: wrapWithScope("image", Preview),
};
export { TOOL_NAME };

export const REGISTRATION: PluginRegistration = {
  toolName: TOOL_NAME,
  entry: generateImagePlugin,
};
