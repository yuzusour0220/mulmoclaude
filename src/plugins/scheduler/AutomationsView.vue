<template>
  <!-- Automations view — both the standalone /automations page and the
       `manageAutomations` chat tool result render TasksTab directly.
       TasksTab is self-contained: it fetches via /api/scheduler/tasks
       (and reacts to the /automations/:taskId route param), so the
       tool-result `selectedResult` carries no task data it needs. The
       prop / emit are declared to honour the plugin view contract and
       keep the host's `selected-result` / `update-result` bindings from
       falling through to the DOM. -->
  <div class="h-full bg-white flex flex-col" data-testid="scheduler-view-root">
    <TasksTab />
  </div>
</template>

<script setup lang="ts">
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import TasksTab from "./TasksTab.vue";
import type { SchedulerData } from "./index";

defineProps<{
  selectedResult?: ToolResultComplete<SchedulerData>;
}>();

defineEmits<{ updateResult: [result: ToolResultComplete] }>();
</script>
