<template>
  <div class="h-full bg-white flex flex-col">
    <!-- API error banner — surfaces POST /api/todos failures so a
         silent add/remove/toggle becomes diagnosable. -->
    <div v-if="todoApiError" class="px-4 py-2 bg-red-50 border-b border-red-200 text-sm text-red-700" role="alert" data-testid="todo-api-error">
      {{ t("apiError", { error: todoApiError }) }}
    </div>
    <div class="flex items-center justify-between px-6 py-4 border-b border-gray-100">
      <h2 class="text-lg font-semibold text-gray-800">{{ t("heading") }}</h2>
      <span class="text-sm text-gray-500">{{ t("completedRatio", { done: completedCount, total: items.length }) }}</span>
    </div>

    <!-- Filter bar: only shown when at least one label is in use. -->
    <div v-if="labelInventory.length > 0" class="flex flex-wrap items-center gap-1.5 px-6 py-2 border-b border-gray-100 bg-gray-50">
      <span class="text-xs text-gray-500 mr-1">{{ t("filter") }}</span>
      <button
        v-for="entry in labelInventory"
        :key="entry.label"
        class="px-2 py-0.5 rounded-full text-xs font-medium transition-all"
        :class="
          activeFilters.has(entry.label.toLowerCase())
            ? 'ring-2 ring-blue-400 ' + colorForLabel(entry.label)
            : colorForLabel(entry.label) + ' opacity-70 hover:opacity-100'
        "
        @click="toggleFilter(entry.label)"
      >
        {{ entry.label }}
        <span class="opacity-60">{{ entry.count }}</span>
      </button>
      <button v-if="activeFilters.size > 0" class="ml-auto text-xs text-gray-500 hover:text-gray-700" :title="t('clearFilters')" @click="clearFilters">
        {{ t("clearButton") }}
      </button>
    </div>

    <div v-if="items.length === 0" class="flex-1 flex items-center justify-center text-gray-400">{{ t("noItems") }}</div>

    <div v-else-if="filteredItems.length === 0" class="flex-1 flex items-center justify-center text-gray-400 text-sm">
      {{ t("noMatchingFilter") }}
    </div>

    <ul v-else class="flex-1 overflow-y-auto p-4 space-y-2">
      <li v-for="item in filteredItems" :key="item.id" class="rounded-lg border" :class="selectedId === item.id ? 'border-blue-400' : 'border-gray-200'">
        <!-- Item row — `role="button"` + tabindex/keydown rather than
             a real `<button>` because the row hosts nested
             interactives (checkbox, delete) that would be invalid
             children of a button element. The `.self` modifier on
             both keydown handlers stops Enter/Space pressed on
             those nested controls from also toggling the row
             (and from `preventDefault`-ing the child's native
             activation). -->
        <div
          class="flex items-center gap-3 p-3 cursor-pointer group hover:bg-gray-50 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          :class="selectedId === item.id ? 'rounded-b-none' : ''"
          role="button"
          tabindex="0"
          :aria-expanded="selectedId === item.id"
          :aria-label="selectedId === item.id ? t('collapse') : t('expand')"
          @click="selectItem(item)"
          @keydown.self.enter.prevent="selectItem(item)"
          @keydown.self.space.prevent="selectItem(item)"
        >
          <input type="checkbox" :checked="item.completed" class="cursor-pointer shrink-0" @click.stop @change="toggle(item)" />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-sm" :class="item.completed ? 'line-through text-gray-400' : 'text-gray-800'">{{ item.text }}</span>
              <span
                v-for="label in item.labels ?? []"
                :key="label"
                class="px-1.5 py-0.5 rounded-full text-[10px] font-medium shrink-0"
                :class="colorForLabel(label)"
                >{{ label }}</span
              >
            </div>
            <div v-if="item.note" class="text-xs text-gray-400 mt-0.5">
              {{ item.note }}
            </div>
          </div>
          <button
            class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 text-gray-400 hover:text-red-500 text-xs px-1 shrink-0"
            :title="t('deleteItem')"
            @click.stop="remove(item)"
          >
            {{ t("deleteSymbol") }}
          </button>
          <span class="material-icons text-gray-400 text-sm" :title="selectedId === item.id ? t('collapse') : t('expand')">
            {{ selectedId === item.id ? "expand_less" : "expand_more" }}
          </span>
        </div>

        <!-- Inline editor -->
        <div v-if="selectedId === item.id" class="border-t border-blue-100 bg-blue-50 p-4 space-y-3 rounded-b-lg">
          <textarea
            v-model="yamlText"
            class="w-full h-24 p-3 font-mono text-xs bg-white border border-blue-300 rounded resize-y focus:outline-none focus:border-blue-500"
            spellcheck="false"
          />
          <div class="flex items-center gap-2">
            <button class="px-3 py-1.5 text-sm rounded bg-blue-500 text-white hover:bg-blue-600" @click="applyItemEdit">{{ t("update") }}</button>
            <button class="px-3 py-1.5 text-sm rounded border border-gray-300 text-gray-600 hover:bg-gray-50" @click="selectedId = null">
              {{ t("cancel") }}
            </button>
            <span v-if="yamlError" class="text-xs text-red-500">{{ yamlError }}</span>
          </div>
        </div>
      </li>
    </ul>

    <button v-if="hasCompleted" class="mx-6 mb-2 text-sm text-gray-500 hover:text-gray-700 self-start" @click="clearCompleted">
      {{ t("clearCompleted") }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type { ToolResultComplete } from "gui-chat-protocol/vue";
import { useRuntime } from "gui-chat-protocol/vue";
import type { TodoData, TodoItem } from "./types";
import { colorForLabel, filterByLabels, listLabelsWithCount } from "./labels";
import { useT, format } from "./lang";

const messages = useT();

// Wrapper that returns either a plain string or a placeholder-substituted
// one. Mirrors vue-i18n's `t(key, params)` shape so the existing template
// (e.g. `{{ t("completedRatio", { done, total }) }}`) keeps
// reading naturally — see calls below.
function t(key: keyof typeof messages.value, params?: Record<string, string | number>): string {
  const template = messages.value[key];
  return params ? format(template, params) : template;
}

const props = defineProps<{
  selectedResult: ToolResultComplete<TodoData>;
}>();
const emit = defineEmits<{ updateResult: [result: ToolResultComplete] }>();

const items = ref<TodoItem[]>(props.selectedResult.data?.items ?? []);

const { dispatch, pubsub } = useRuntime();

interface ListResponse {
  data?: { items?: TodoItem[] };
}

async function refresh(): Promise<void> {
  try {
    const result = await dispatch<ListResponse>({ kind: "listAll" });
    if (Array.isArray(result.data?.items)) items.value = result.data.items;
  } catch {
    // Network or auth issue — leave the existing list alone so the
    // user keeps seeing what they already had. The next pubsub
    // "changed" tick will retry.
  }
}

let unsub: (() => void) | undefined;
onMounted(() => {
  unsub = pubsub.subscribe("changed", () => {
    void refresh();
  });
  void refresh();
});
onUnmounted(() => unsub?.());

// Re-fetch when the caller swaps in a different tool result.
watch(
  () => props.selectedResult.uuid,
  () => {
    items.value = props.selectedResult.data?.items ?? [];
    void refresh();
  },
);
const completedCount = computed(() => items.value.filter((i) => i.completed).length);
const hasCompleted = computed(() => items.value.some((i) => i.completed));

// ── Label filter state ──────────────────────────────────────────────────────
// Filters are local to this View instance — intentional, so that
// switching sessions or reopening a tool result doesn't drag state
// across contexts. Active filters are stored lowercased to match
// `filterByLabels`' case-insensitive semantics.

const activeFilters = ref<Set<string>>(new Set());

const labelInventory = computed(() => listLabelsWithCount(items.value));

const filteredItems = computed(() => filterByLabels(items.value, [...activeFilters.value]));

function toggleFilter(label: string): void {
  const key = label.toLowerCase();
  const next = new Set(activeFilters.value);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  activeFilters.value = next;
}

function clearFilters(): void {
  activeFilters.value = new Set();
}

// ── YAML helpers ─────────────────────────────────────────────────────────────

function yamlStringValue(str: string): string {
  const needsQuotes = str === "" || /[:#[\]{},&*?|<>=!%@`]/.test(str) || /^\s|\s$/.test(str) || /^(true|false|null|~)$/i.test(str) || /^\d/.test(str);
  if (needsQuotes) {
    return `"${str.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return str;
}

function serializeYaml(item: TodoItem): string {
  const labels = item.labels ?? [];
  const labelsLine = labels.length > 0 ? `labels: [${labels.map(yamlStringValue).join(", ")}]` : "labels: []";
  return [`text: ${yamlStringValue(item.text)}`, `note: ${item.note ? yamlStringValue(item.note) : ""}`, labelsLine].join("\n");
}

// Parse a YAML flow sequence `[a, "b", c]` into an array of strings.
// Handles quoted and unquoted entries. Whitespace-only input → empty.
function parseFlowSequence(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "[]") return [];
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return [];
  const inner = trimmed.slice(1, -1);
  // Split on commas that are NOT inside double quotes. Cheap scan;
  // fine for our label use case where items don't contain commas
  // (stored labels are normalised strings without commas).
  const result: string[] = [];
  let buffer = "";
  let inQuotes = false;
  for (let i = 0; i < inner.length; i++) {
    const char = inner[i];
    if (char === '"' && inner[i - 1] !== "\\") {
      inQuotes = !inQuotes;
      buffer += char;
      continue;
    }
    if (char === "," && !inQuotes) {
      const piece = parseYamlValue(buffer.trim());
      if (piece) result.push(piece);
      buffer = "";
      continue;
    }
    buffer += char;
  }
  const last = parseYamlValue(buffer.trim());
  if (last) result.push(last);
  return result;
}

function parseYamlValue(raw: string): string {
  if (raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  if (raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1);
  }
  return raw;
}

function parseYaml(text: string): { text: string; note: string; labels: string[] } | null {
  const result: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colonIdx = line.indexOf(": ");
    if (colonIdx === -1) {
      // "key:" with empty value
      const colonEnd = line.indexOf(":");
      if (colonEnd !== -1) result[line.slice(0, colonEnd).trim()] = "";
      continue;
    }
    // `labels:` is a flow sequence (`[a, b]`) — parse it as a list
    // instead of running it through `parseYamlValue` which strips
    // brackets as if they were quotes.
    const key = line.slice(0, colonIdx).trim();
    const raw = line.slice(colonIdx + 2).trim();
    if (key === "labels") {
      result[key] = raw;
      continue;
    }
    result[key] = parseYamlValue(raw);
  }
  if (typeof result["text"] !== "string" || !result["text"]) return null;
  const labels = parseFlowSequence(result["labels"] ?? "[]");
  return {
    text: result["text"],
    note: result["note"] ?? "",
    labels,
  };
}

// ── Item selection & YAML edit ────────────────────────────────────────────────

const selectedId = ref<string | null>(null);
const yamlText = ref("");
const yamlError = ref("");

function selectItem(item: TodoItem) {
  if (selectedId.value === item.id) {
    selectedId.value = null;
    return;
  }
  selectedId.value = item.id;
  yamlText.value = serializeYaml(item);
  yamlError.value = "";
}

watch(items, () => {
  if (!selectedId.value) return;
  const item = items.value.find((i) => i.id === selectedId.value);
  if (item) yamlText.value = serializeYaml(item);
  else selectedId.value = null;
});

async function applyItemEdit() {
  yamlError.value = "";
  const parsed = parseYaml(yamlText.value);
  if (!parsed) {
    yamlError.value = t("yamlParseError");
    return;
  }
  // Single id-based UI patch — `handlePatch` accepts text + note +
  // labels in one call and applies them atomically. The earlier
  // multi-call LLM-action flow (`update` + `add_label` + `remove_label`)
  // resolved items by case-insensitive substring match on text, so two
  // todos with similar titles could clobber each other; the UI knows
  // the id, so use it.
  const id = selectedId.value;
  if (!id) return;
  const ok = await callApi({
    kind: "itemPatch",
    id,
    text: parsed.text,
    note: parsed.note,
    labels: parsed.labels,
  });
  if (!ok) return;
  selectedId.value = null;
}

// ── API ───────────────────────────────────────────────────────────────────────

// Last POST /api/todos failure. Cleared on the next successful call so
// the banner disappears as soon as things recover.
const todoApiError = ref<string | null>(null);

interface CallApiResult {
  data?: { items?: TodoItem[] };
  message?: string;
  jsonData?: unknown;
  instructions?: string;
  error?: string;
}

async function callApi(body: Record<string, unknown>): Promise<boolean> {
  try {
    const result = await dispatch<CallApiResult>(body);
    if (result.error) {
      todoApiError.value = result.error;
      return false;
    }
    todoApiError.value = null;
    items.value = result.data?.items ?? [];
    emit("updateResult", {
      ...props.selectedResult,
      ...result,
      uuid: props.selectedResult.uuid,
    } as ToolResultComplete);
    return true;
  } catch (err) {
    todoApiError.value = err instanceof Error ? err.message : String(err);
    return false;
  }
}

function toggle(item: TodoItem) {
  // id-based patch — server's `applyCompletedPatch` flips the
  // completed flag and moves the item between the done column
  // and the default open column the obvious way. The previous
  // text-based `check` / `uncheck` LLM actions resolved by
  // case-insensitive substring and could mutate the wrong row
  // when two todos share a prefix.
  callApi({ kind: "itemPatch", id: item.id, completed: !item.completed });
}

function remove(item: TodoItem) {
  if (selectedId.value === item.id) selectedId.value = null;
  callApi({ kind: "itemDelete", id: item.id });
}

function clearCompleted() {
  // The LLM `clear_completed` action filters by the boolean flag
  // (no text matching), so it's safe to keep as a single
  // round-trip rather than fanning out into N `itemDelete` calls.
  callApi({ action: "clear_completed" });
}
</script>
