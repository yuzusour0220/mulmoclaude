import type { ToolPlugin } from "gui-chat-protocol/vue";
import type { PluginRegistration } from "../../tools/types";
import type { FormData, FormArgs } from "@mulmoclaude/form-plugin";
import { plugin as formPlugin } from "@mulmoclaude/form-plugin/vue";
import "@mulmoclaude/form-plugin/style.css";
import { wrapWithScope } from "../scope";
import { TOOL_NAME } from "./definition";

// The form's schema, validation, View, and Preview come from the shared
// @mulmoclaude/form-plugin package. We re-wrap its components in MulmoClaude's scoped
// runtime provider (wrapWithScope) so the package's useRuntime()/locale resolves
// to the host — which is what drives the package's bundled i18n.
const presentFormPlugin: ToolPlugin<FormData, FormData, FormArgs> = {
  ...formPlugin,
  viewComponent: wrapWithScope("form", formPlugin.viewComponent),
  previewComponent: wrapWithScope("form", formPlugin.previewComponent),
};

export default presentFormPlugin;
export { TOOL_NAME };

export const REGISTRATION: PluginRegistration = {
  toolName: TOOL_NAME,
  entry: presentFormPlugin,
};
