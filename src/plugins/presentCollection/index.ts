import type { ToolPlugin } from "gui-chat-protocol/vue";
import type { PluginRegistration } from "../../tools/types";
import type { PresentCollectionData, PresentCollectionArgs } from "./types";
import { TOOL_DEFINITION, TOOL_NAME } from "./definition";
import { executePresentCollection } from "./plugin";
import { wrapWithScope } from "../scope";
import View from "./View.vue";
import Preview from "./Preview.vue";

const presentCollectionPlugin: ToolPlugin<PresentCollectionData, PresentCollectionData, PresentCollectionArgs> = {
  toolDefinition: TOOL_DEFINITION,
  execute: executePresentCollection,
  generatingMessage: "Loading collection...",
  isEnabled: () => true,
  viewComponent: wrapWithScope("presentCollection", View),
  previewComponent: wrapWithScope("presentCollection", Preview),
};

export default presentCollectionPlugin;
export { TOOL_NAME };

export const REGISTRATION: PluginRegistration = {
  toolName: TOOL_NAME,
  entry: presentCollectionPlugin,
};
