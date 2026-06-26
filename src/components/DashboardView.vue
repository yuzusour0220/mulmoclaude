<template>
  <div class="h-full overflow-auto p-4" data-testid="dashboard-view">
    <!-- Empty state: no pinned collections yet. -->
    <div v-if="favoriteSlugs.length === 0" class="h-full flex flex-col items-center justify-center text-center text-slate-500 gap-2">
      <span class="material-icons text-4xl text-slate-300">dashboard</span>
      <p class="text-sm font-medium">{{ t("dashboard.empty") }}</p>
      <p class="text-xs">{{ t("dashboard.emptyHint") }}</p>
    </div>

    <!-- Two-column grid of favorite collections. Each tile shows a live
         embedded CollectionView in the tile's chosen view mode. Grid rows
         stretch (default), so two tiles side by side share the height of
         the taller one; each tile's set height acts as its minimum. -->
    <div v-else class="grid gap-4 sm:grid-cols-2" data-testid="dashboard-grid">
      <section
        v-for="(tile, index) in tiles"
        v-show="metaFor(tile.slug)"
        :key="tile.slug"
        class="flex flex-col border border-slate-200 rounded-lg bg-white overflow-hidden shadow-sm"
        :class="{ 'ring-2 ring-indigo-400': dropIndex === index }"
        :data-testid="`dashboard-tile-${tile.slug}`"
        @dragover.prevent="dropIndex = index"
        @drop.prevent="onDrop(index)"
      >
        <!-- Tile header: drag handle + title/icon (opens full view) + view picker. -->
        <header class="flex items-center gap-2 px-3 py-2 border-b border-slate-100 bg-slate-50">
          <span
            class="material-icons text-base text-slate-400 cursor-grab select-none"
            draggable="true"
            :title="t('dashboard.dragHint')"
            :aria-label="t('dashboard.dragHint')"
            data-testid="dashboard-tile-drag"
            @dragstart="onDragStart(index)"
            @dragend="onDragEnd"
            >drag_indicator</span
          >
          <button
            type="button"
            class="flex items-center gap-1.5 min-w-0 flex-1 text-left text-sm font-semibold text-slate-700 hover:text-indigo-600"
            :title="t('dashboard.openFull')"
            @click="openFull(tile.slug)"
          >
            <span class="material-symbols-outlined text-base flex-none">{{ metaFor(tile.slug)?.icon || "apps" }}</span>
            <span class="truncate">{{ metaFor(tile.slug)?.title || tile.slug }}</span>
          </button>
          <select
            class="flex-none text-xs bg-white border border-slate-200 rounded px-1.5 py-1 text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            :value="effectiveView(tile)"
            :aria-label="t('dashboard.viewPickerLabel')"
            :data-testid="`dashboard-tile-view-${tile.slug}`"
            @change="onPickView(tile.slug, $event)"
          >
            <option v-for="mode in modesFor(tile.slug)" :key="mode" :value="mode">{{ modeLabel(tile.slug, mode) }}</option>
          </select>
        </header>
        <!-- Live embedded view. `:key` remounts the view when the mode
             changes so the new initial view takes effect. The tile's set
             height is the body's MIN height; `flex-1` lets it grow to fill
             when a taller sibling stretches the row. -->
        <div class="flex-1 overflow-auto" :style="{ minHeight: `${bodyHeight(tile)}px` }">
          <CollectionView
            :key="`${tile.slug}:${effectiveView(tile)}`"
            :slug="tile.slug"
            :initial-view="effectiveView(tile)"
            hide-view-toggle
            hide-header
            hide-search
          />
        </div>
        <!-- Resize handle: drag vertically to set this tile's height. -->
        <div
          class="h-2 flex-none cursor-row-resize bg-slate-100 hover:bg-indigo-200 transition-colors flex items-center justify-center"
          :title="t('dashboard.resizeHint')"
          :aria-label="t('dashboard.resizeHint')"
          :data-testid="`dashboard-tile-resize-${tile.slug}`"
          @pointerdown.prevent="onResizeStart(tile, $event)"
        >
          <span class="h-0.5 w-8 rounded-full bg-slate-300"></span>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { CollectionView, applicableViewModes, customViewKey, type CollectionViewMode } from "@mulmoclaude/collection-plugin/vue";
import { useShortcuts } from "../composables/useShortcuts";
import { useDashboard } from "../composables/useDashboard";
import { apiGet } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";
import { PAGE_ROUTES } from "../router/pageRoutes";
import type { DashboardTile } from "../types/dashboard";
import type { CollectionDetailResponse, CollectionSchema } from "./collectionTypes";

const { t } = useI18n();
const router = useRouter();

const { shortcuts, load: loadShortcuts } = useShortcuts();
const { tiles, load: loadDashboard, reconcile, setTiles, setViewMode, setHeight } = useDashboard();

// Favorites = pinned COLLECTION shortcuts (feeds are excluded — the
// dashboard is a collections surface). The cached title/icon ride along
// so a tile renders without an extra fetch.
const collectionFavorites = computed(() => shortcuts.value.filter((entry) => entry.kind === "collection"));
const favoriteSlugs = computed(() => collectionFavorites.value.map((entry) => entry.slug));
const metaFor = (slug: string) => collectionFavorites.value.find((entry) => entry.slug === slug);

// Per-slug schema, fetched lazily to drive each tile's view picker.
const schemas = ref<Record<string, CollectionSchema>>({});

async function loadSchema(slug: string): Promise<void> {
  if (schemas.value[slug]) return;
  const url = API_ROUTES.collections.detail.replace(":slug", encodeURIComponent(slug));
  const result = await apiGet<CollectionDetailResponse>(url);
  if (result.ok) schemas.value = { ...schemas.value, [slug]: result.data.collection.schema };
}

function modesFor(slug: string): CollectionViewMode[] {
  const schema = schemas.value[slug];
  return schema ? applicableViewModes(schema) : ["table"];
}

/** The view a tile opens in: its stored mode when still applicable, else
 *  the first available mode (table). */
function effectiveView(tile: DashboardTile): CollectionViewMode {
  const modes = modesFor(tile.slug);
  return tile.viewMode && modes.includes(tile.viewMode as CollectionViewMode) ? (tile.viewMode as CollectionViewMode) : (modes[0] ?? "table");
}

const BUILTIN_LABEL_KEYS: Record<string, string> = {
  table: "dashboard.viewTable",
  calendar: "dashboard.viewCalendar",
  kanban: "dashboard.viewKanban",
};

function modeLabel(slug: string, mode: CollectionViewMode): string {
  const builtin = BUILTIN_LABEL_KEYS[mode];
  if (builtin) return t(builtin);
  // Custom view: use the author-authored label from the schema.
  const view = schemas.value[slug]?.views?.find((entry) => customViewKey(entry.id) === mode);
  return view?.label ?? mode;
}

function onPickView(slug: string, event: Event): void {
  const { value } = event.target as HTMLSelectElement;
  void setViewMode(slug, value);
}

function openFull(slug: string): void {
  router.push({ name: PAGE_ROUTES.collections, params: { slug } }).catch(() => {});
}

// ── Drag-to-reorder (independent of the launcher's shortcut order) ──
const dragIndex = ref<number | null>(null);
const dropIndex = ref<number | null>(null);

function onDragStart(index: number): void {
  dragIndex.value = index;
}

function onDragEnd(): void {
  dragIndex.value = null;
  dropIndex.value = null;
}

function onDrop(target: number): void {
  const from = dragIndex.value;
  onDragEnd();
  if (from === null || from === target) return;
  const next = [...tiles.value];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  void setTiles(next);
}

// ── Per-tile drag-to-resize (height stored on the tile, independent) ──
const DEFAULT_HEIGHT = 320;
const MIN_HEIGHT = 160;
const MAX_HEIGHT = 900;

// Live height during a drag (smooth, not yet persisted), keyed by slug.
const liveHeights = ref<Record<string, number>>({});

function bodyHeight(tile: DashboardTile): number {
  return liveHeights.value[tile.slug] ?? tile.height ?? DEFAULT_HEIGHT;
}

let resize: { slug: string; startY: number; startHeight: number } | null = null;

function onResizeMove(event: PointerEvent): void {
  if (!resize) return;
  const next = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, resize.startHeight + (event.clientY - resize.startY)));
  liveHeights.value = { ...liveHeights.value, [resize.slug]: next };
}

function clearLiveHeight(slug: string): void {
  liveHeights.value = Object.fromEntries(Object.entries(liveHeights.value).filter(([key]) => key !== slug));
}

// Persist the final height, then drop the live override so the stored
// value (now identical) takes over without a flash.
async function persistHeight(slug: string, height: number): Promise<void> {
  await setHeight(slug, Math.round(height));
  clearLiveHeight(slug);
}

function onResizeEnd(): void {
  window.removeEventListener("pointermove", onResizeMove);
  window.removeEventListener("pointerup", onResizeEnd);
  if (!resize) return;
  const { slug } = resize;
  resize = null;
  const height = liveHeights.value[slug];
  if (height !== undefined) void persistHeight(slug, height);
}

function onResizeStart(tile: DashboardTile, event: PointerEvent): void {
  resize = { slug: tile.slug, startY: event.clientY, startHeight: bodyHeight(tile) };
  window.addEventListener("pointermove", onResizeMove);
  window.addEventListener("pointerup", onResizeEnd);
}

onBeforeUnmount(() => {
  window.removeEventListener("pointermove", onResizeMove);
  window.removeEventListener("pointerup", onResizeEnd);
});

// First load: fold favorites into the stored layout once both lists are
// authoritatively loaded (so an empty pre-load list never prunes tiles).
onMounted(async () => {
  await Promise.all([loadShortcuts(), loadDashboard()]);
  await reconcile(favoriteSlugs.value);
});

// Later pin/unpin while on the page re-reconciles. Non-immediate so it
// can't fire on the empty pre-load list.
watch(favoriteSlugs, (slugs) => void reconcile(slugs));

// Fetch each tile's schema as the layout settles.
watch(tiles, (list) => list.forEach((tile) => void loadSchema(tile.slug)), { immediate: true });
</script>
