// Rendering + linked-data layer for collection surfaces, extracted from
// CollectionView.vue so the list/detail view AND the calendar view's
// record panel share one implementation (and one set of ref/embed
// caches). Owns: the per-target caches, the fan-out fetch that fills
// them, and every helper that turns a stored value into something the
// templates render (ref labels, money/currency, derived formulas, embed
// rows). Pure-but-stateful: instantiate ONCE per collection surface and
// pass the returned object down to child panels.
//
// The pure, reactivity-free transforms this composable relies on live in
// `useCollectionRendering.helpers.ts` (plain TS, unit-tested); only the
// ref/computed/watch-bound glue stays here.

import { ref, type Ref } from "vue";
import { collectionUi } from "./uiContext";
import { deriveAll, embedTargetId } from "@mulmoclaude/core/collection";
import type {
  CollectionDetail,
  CollectionItem,
  CollectionSchema,
  CollectionFieldSpec as FieldSpec,
  CollectionFieldType as FieldType,
  EmbedCache,
  EmbedRow,
  EmbedView,
  RefCache,
  RefOption,
  RefRecordCache,
} from "@mulmoclaude/core/collection";
import {
  buildEmbedOptions,
  buildRefDisplayMap,
  buildRefRecordMap,
  currencySymbolForLocale,
  detailText,
  formatCell,
  formatMoney,
  hasTableRows,
  inputTypeFor,
  isExternalUrl,
  resolveCurrency,
  sortedRefOptions,
  stepForFieldType,
  tableRows,
  uniqueEmbedTargets,
  uniqueRefTargets,
} from "./useCollectionRendering.helpers";

export interface CollectionRendering {
  refCache: Ref<RefCache>;
  refRecordCache: Ref<RefRecordCache>;
  embedCache: Ref<EmbedCache>;
  resetLinkedCaches: () => void;
  loadLinkedCollections: (schema: CollectionSchema, expectedSlug: string) => Promise<void>;
  refDisplay: (targetSlug: string, itemSlug: string) => string;
  refOptions: (targetSlug: string) => RefOption[];
  embedOptions: (targetSlug: string) => RefOption[];
  embedViewsFor: (record: CollectionItem | null) => Record<string, EmbedView>;
  resolveCurrency: (field: FieldSpec, record: CollectionItem | null | undefined) => string | undefined;
  currencySymbol: (currency: string | undefined) => string;
  formatMoney: (value: unknown, currency: string | undefined, displayLocale: string) => string;
  formatCell: (value: unknown, type: FieldType) => string;
  detailText: (value: unknown) => string;
  isExternalUrl: (value: unknown) => boolean;
  artifactUrl: (value: unknown) => string | null;
  fileRoutePath: (value: unknown) => string | null;
  tableRows: (value: unknown) => Record<string, unknown>[];
  hasTableRows: (value: unknown) => boolean;
  formatSubCell: (subField: FieldSpec, value: unknown, record: CollectionItem | null) => string;
  inputTypeFor: (type: FieldType) => string;
  stepFor: (type: FieldType) => string | undefined;
  deriveAll: (schema: CollectionSchema, base: CollectionItem, refRecords: RefRecordCache) => CollectionItem;
  evaluateDerivedAgainstItem: (field: FieldSpec, fieldKey: string, item: CollectionItem) => number | null;
  derivedDisplay: (field: FieldSpec, computedValue: unknown, record: CollectionItem | null) => string;
}

export function useCollectionRendering(collection: Ref<CollectionDetail | null>, locale: Ref<string>): CollectionRendering {
  const refCache = ref<RefCache>({});
  const refRecordCache = ref<RefRecordCache>({});
  const embedCache = ref<EmbedCache>({});

  function resetLinkedCaches(): void {
    refCache.value = {};
    refRecordCache.value = {};
    embedCache.value = {};
  }

  async function loadLinkedCollections(schema: CollectionSchema, expectedSlug: string): Promise<void> {
    const refTargets = new Set(uniqueRefTargets(schema));
    const embedTargets = new Set(uniqueEmbedTargets(schema));
    const allTargets = [...new Set([...refTargets, ...embedTargets])];
    if (allTargets.length === 0) return;
    // Best-effort: a single target whose fetch *rejects* (vs. resolving to
    // `{ ok: false }`) must not abort the others, so coerce a throw to a skip.
    const binding = collectionUi();
    const results = await Promise.all(
      allTargets.map(async (target) => {
        try {
          return { target, result: await binding.fetchCollectionDetail(target) };
        } catch {
          return { target, result: { ok: false as const } };
        }
      }),
    );
    // Stale-write guard: a quicker subsequent load may have replaced
    // `collection.value`; dropping the write avoids surfacing the
    // previous collection's linked data on the current one.
    if (collection.value?.slug !== expectedSlug) return;
    const nextRef: RefCache = {};
    const nextRefRecords: RefRecordCache = {};
    const nextEmbed: EmbedCache = {};
    for (const { target, result } of results) {
      if (!result.ok) continue;
      if (refTargets.has(target)) {
        nextRef[target] = buildRefDisplayMap(result.data);
        nextRefRecords[target] = buildRefRecordMap(result.data);
      }
      if (embedTargets.has(target)) nextEmbed[target] = { schema: result.data.collection.schema, items: result.data.items };
    }
    refCache.value = nextRef;
    refRecordCache.value = nextRefRecords;
    embedCache.value = nextEmbed;
  }

  function refDisplay(targetSlug: string, itemSlug: string): string {
    const map = refCache.value[targetSlug];
    return (map && map[itemSlug]) || itemSlug;
  }

  function refOptions(targetSlug: string): RefOption[] {
    const map = refCache.value[targetSlug];
    return map ? sortedRefOptions(map) : [];
  }

  /** Dropdown options for an `embed` field's per-record picker (`idField`):
   *  every record in the target collection, labelled by its name/title (or
   *  primary key). Built from `embedCache` so it works for embed targets
   *  that aren't also `ref` targets (the profile collection, say). */
  function embedOptions(targetSlug: string): RefOption[] {
    const data = embedCache.value[targetSlug];
    return data ? buildEmbedOptions(data.schema, data.items) : [];
  }

  function resolveEmbed(field: FieldSpec, record: CollectionItem | null): { schema: CollectionSchema | null; item: CollectionItem | null } {
    if (field.type !== "embed" || !field.to) return { schema: null, item: null };
    const targetId = embedTargetId(field, record);
    const data = targetId ? embedCache.value[field.to] : undefined;
    if (!data) return { schema: null, item: null };
    const item = data.items.find((entry) => String(entry[data.schema.primaryKey] ?? "") === targetId) ?? null;
    return { schema: data.schema, item };
  }

  function embedValue(field: FieldSpec, value: unknown, record: CollectionItem | null): string {
    if (field.type === "money") return formatMoney(value, resolveCurrency(field, record), locale.value);
    return detailText(value);
  }

  /** Build the read-only embed view-models for one record. A function of
   *  the open record (not a bare computed) because a per-record `idField`
   *  embed resolves a different target per row. */
  function embedViewsFor(record: CollectionItem | null): Record<string, EmbedView> {
    const out: Record<string, EmbedView> = {};
    if (!collection.value) return out;
    for (const [key, field] of Object.entries(collection.value.schema.fields)) {
      if (field.type !== "embed") continue;
      const { schema, item } = resolveEmbed(field, record);
      const rows: EmbedRow[] = [];
      if (schema && item) {
        for (const [subKey, subField] of Object.entries(schema.fields)) {
          const value = item[subKey];
          // Skip empty fields — the embed is a read-only summary, so
          // unfilled optionals would just be "—" noise.
          if (value === undefined || value === null || value === "") continue;
          rows.push({ key: subKey, label: subField.label, type: subField.type, value, display: embedValue(subField, value, item) });
        }
      }
      out[key] = { found: Boolean(item), rows, targetSlug: field.to ?? "", recordId: embedTargetId(field, record) };
    }
    return out;
  }

  function currencySymbol(currency: string | undefined): string {
    return currencySymbolForLocale(currency, locale.value);
  }

  // A `file` field holds a workspace-relative path. When it points at an
  // HTML/SVG artifact the server serves directly, return that served URL
  // so the rendered app can open in a new tab; otherwise null. Reject
  // absolute / `..`-traversing paths first (same guard as fileRoutePath)
  // — the preview-URL builders don't, so a `..` would normalize out of
  // the intended mount.
  function artifactUrl(value: unknown): string | null {
    return collectionUi().fileAssetUrl(value);
  }

  // In-app File Explorer route for a workspace path — the fallback for
  // `file` values that aren't a directly-served artifact. The host owns the
  // path validity + route scheme.
  function fileRoutePath(value: unknown): string | null {
    return collectionUi().fileRoutePath(value);
  }

  function formatSubCell(subField: FieldSpec, value: unknown, record: CollectionItem | null): string {
    if (subField.type === "money") return formatMoney(value, resolveCurrency(subField, record), locale.value);
    if (subField.type === "ref" && subField.to && typeof value === "string" && value.length > 0) return refDisplay(subField.to, value);
    return formatCell(value, subField.type);
  }

  const stepFor = stepForFieldType;

  // The derive loop itself lives in `utils/collections/deriveAll.ts`,
  // shared with the server's manageCollection enrichment so both sides
  // compute identical values. This composable re-exposes it (typed with
  // the richer client types via structural assignability) plus the
  // collection-bound convenience wrappers below.

  function evaluateDerivedAgainstItem(field: FieldSpec, fieldKey: string, item: CollectionItem): number | null {
    if (!field.formula || !collection.value) return null;
    const enriched = deriveAll(collection.value.schema, item, refRecordCache.value);
    const result = enriched[fieldKey];
    return typeof result === "number" && Number.isFinite(result) ? result : null;
  }

  function derivedDisplay(field: FieldSpec, computedValue: unknown, record: CollectionItem | null): string {
    if (computedValue === null || computedValue === undefined) return "—";
    if (field.display === "money") return formatMoney(computedValue, resolveCurrency(field, record), locale.value);
    return formatCell(computedValue, field.display ?? "number");
  }

  return {
    refCache,
    refRecordCache,
    embedCache,
    resetLinkedCaches,
    loadLinkedCollections,
    refDisplay,
    refOptions,
    embedOptions,
    embedViewsFor,
    resolveCurrency,
    currencySymbol,
    formatMoney,
    formatCell,
    detailText,
    isExternalUrl,
    artifactUrl,
    fileRoutePath,
    tableRows,
    hasTableRows,
    formatSubCell,
    inputTypeFor,
    stepFor,
    deriveAll,
    evaluateDerivedAgainstItem,
    derivedDisplay,
  };
}
