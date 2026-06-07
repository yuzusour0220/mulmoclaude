// Scheduler plugin — `manageAutomations` (recurring agent tasks).
// The Calendar view + `manageCalendar` tool were removed; automations
// now owns the `/api/scheduler` namespace (see `automationsMeta.ts`).
// The server still dispatches per-action via TASK_ACTIONS.

import type { PluginRegistration, ToolPlugin } from "../../tools/types";
import type { ToolResult } from "gui-chat-protocol";
import AutomationsView from "./AutomationsView.vue";
import AutomationsPreview from "./AutomationsPreview.vue";
import automationsDefinition, { TOOL_NAME as MANAGE_AUTOMATIONS, type SchedulerEndpoints } from "./automationsDefinition";
import { pluginEndpoints } from "../api";
import { wrapWithScope } from "../scope";
import { apiCall } from "../../utils/api";
import { makeUuid } from "../../utils/id";

export interface ScheduledItem {
  id: string;
  title: string;
  createdAt: number;
  props: Record<string, string | number | boolean | null>;
}

export interface SchedulerData {
  items: ScheduledItem[];
}

const execute: ToolPlugin<SchedulerData>["execute"] = async function execute(_context, args) {
  const endpoints = pluginEndpoints<SchedulerEndpoints>("scheduler");
  const { method, url } = endpoints.dispatch;
  const result = await apiCall<ToolResult<SchedulerData>>(url, { method, body: args });
  if (!result.ok) {
    return {
      toolName: MANAGE_AUTOMATIONS,
      uuid: makeUuid(),
      message: result.error,
    };
  }
  return {
    ...result.data,
    toolName: MANAGE_AUTOMATIONS,
    uuid: result.data.uuid ?? makeUuid(),
  };
};

export const manageAutomationsPlugin: ToolPlugin<SchedulerData> = {
  toolDefinition: automationsDefinition,
  execute,
  isEnabled: () => true,
  generatingMessage: "Managing automations...",
  viewComponent: wrapWithScope("scheduler", AutomationsView),
  previewComponent: wrapWithScope("scheduler", AutomationsPreview),
};

export const REGISTRATIONS: PluginRegistration[] = [{ toolName: MANAGE_AUTOMATIONS, entry: manageAutomationsPlugin }];
