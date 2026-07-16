<template>
  <div class="space-y-3" data-testid="settings-google-tab">
    <p class="text-sm text-gray-700">{{ t("settingsModal.googleTab.description") }}</p>

    <p v-if="loaded && !clientSecretFound" class="text-sm text-amber-700" data-testid="settings-google-secret-missing">
      {{ t("settingsModal.googleTab.clientSecretMissing") }}
    </p>

    <div v-if="loaded" class="flex items-center gap-3">
      <span class="text-sm" :class="statusColour" data-testid="settings-google-status">{{ statusText }}</span>
      <button
        v-if="!linked"
        class="px-2 py-1 text-xs rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
        :disabled="busy || pending || !clientSecretFound"
        data-testid="settings-google-connect-btn"
        @click="connect"
      >
        {{ t("settingsModal.googleTab.connect") }}
      </button>
      <button
        v-else
        class="px-2 py-1 text-xs rounded border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-50"
        :disabled="busy"
        data-testid="settings-google-unlink-btn"
        @click="unlink"
      >
        {{ t("settingsModal.googleTab.unlink") }}
      </button>
    </div>

    <p v-if="errorText" class="text-sm text-red-700" role="alert" data-testid="settings-google-error">{{ errorText }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { apiGet, apiPost } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";

const { t } = useI18n();

const props = defineProps<{
  /** Bumped by the parent each time the modal opens so the status
   *  reflects out-of-band changes (`yarn google:auth`, manual token
   *  file removal, …). */
  reloadToken: number;
}>();

interface GoogleStatusResponse {
  linked: boolean;
  pending: boolean;
  clientSecretFound: boolean;
  lastError: string | null;
}

const STATUS_POLL_INTERVAL_MS = 2_000;
const MAX_POLL_FAILURES = 10;

const linked = ref(false);
const pending = ref(false);
const clientSecretFound = ref(false);
const loaded = ref(false);
const busy = ref(false);
const errorText = ref("");
const pollTimer = ref<ReturnType<typeof setTimeout> | null>(null);
const pollFailures = ref(0);

const statusText = computed(() => {
  if (pending.value) return t("settingsModal.googleTab.statusPending");
  return linked.value ? t("settingsModal.googleTab.statusLinked") : t("settingsModal.googleTab.statusNotLinked");
});

const statusColour = computed(() => (linked.value ? "text-green-600" : "text-gray-500"));

// The flow finishes out-of-band (browser consent → loopback listener), so
// while the server reports pending the tab polls until linked flips or the
// server-side flow times out (pending goes false either way — the poll is
// self-terminating).
const schedulePoll = (): void => {
  if (pollTimer.value) clearTimeout(pollTimer.value);
  pollTimer.value = pending.value ? setTimeout(() => void refresh(), STATUS_POLL_INTERVAL_MS) : null;
};

async function refresh(): Promise<void> {
  const response = await apiGet<GoogleStatusResponse>(API_ROUTES.google.status);
  if (!response.ok) {
    errorText.value = response.error || t("settingsModal.googleTab.loadError");
    // A transient failure must not strand an active consent flow in
    // "pending" forever — keep polling (bounded) so the UI recovers once
    // the server answers again.
    pollFailures.value += 1;
    if (pollFailures.value < MAX_POLL_FAILURES) schedulePoll();
    return;
  }
  pollFailures.value = 0;
  linked.value = response.data.linked;
  pending.value = response.data.pending;
  clientSecretFound.value = response.data.clientSecretFound;
  errorText.value = response.data.lastError ?? "";
  loaded.value = true;
  schedulePoll();
}

async function connect(): Promise<void> {
  busy.value = true;
  errorText.value = "";
  const response = await apiPost<{ authUrl: string }>(API_ROUTES.google.authorize, {});
  busy.value = false;
  if (!response.ok) {
    errorText.value = response.error || t("settingsModal.googleTab.connectError");
    return;
  }
  window.open(response.data.authUrl, "_blank", "noopener");
  pending.value = true;
  pollFailures.value = 0;
  schedulePoll();
}

async function unlink(): Promise<void> {
  if (!window.confirm(t("settingsModal.googleTab.unlinkConfirm"))) return;
  busy.value = true;
  errorText.value = "";
  const response = await apiPost<{ linked: boolean }>(API_ROUTES.google.unlink, {});
  busy.value = false;
  if (!response.ok) {
    errorText.value = response.error || t("settingsModal.googleTab.unlinkError");
    return;
  }
  linked.value = false;
}

watch(
  () => props.reloadToken,
  () => {
    void refresh();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (pollTimer.value) clearTimeout(pollTimer.value);
});
</script>
