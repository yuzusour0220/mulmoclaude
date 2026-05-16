<script setup lang="ts">
// Encore click-handler page (skeleton — Step 1 of
// plans/feat-encore-as-builtin.md). Step 5 wires up the real
// resolveNotification dispatch + redirect-to-/chat/<chatId> flow.
//
// The page exists solely to defer chat creation until the user
// actually clicks a bell entry — there is no UI to interact with.
// See plans/feat-encore-plugin.md §UI for why.

import { computed } from "vue";

const pendingId = computed<string | null>(() => {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  return params.get("pendingId");
});
</script>

<template>
  <!-- eslint-disable @intlify/vue-i18n/no-raw-text -- transient redirect page, not a user-facing surface; strings stay out of the 8-locale bundle (matches debug-plugin's View). -->
  <div class="h-full flex items-center justify-center text-sm text-gray-500">
    <div v-if="pendingId">Encore — pending {{ pendingId }} (skeleton; resolution flow wires up in Step 5)</div>
    <div v-else>Encore — no pendingId in URL (this page only opens from an Encore notification click).</div>
  </div>
  <!-- eslint-enable @intlify/vue-i18n/no-raw-text -->
</template>
