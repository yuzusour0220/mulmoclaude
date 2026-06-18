// @mulmoclaude/collection-plugin/vue — browser UI layer.
//
// The host frontend imports from here (the UI host binding, the rendering
// composable, and the View components). Configure the host binding once at app
// startup — all fields are required (the full CollectionUi contract):
//   import { configureCollectionUi } from "@mulmoclaude/collection-plugin/vue";
//   configureCollectionUi({ fetchCollectionDetail, fileAssetUrl, fileRoutePath, imageSrc });
//
// Styling: the components' Tailwind classes are compiled into the package's
// dist/style.css. The library build EXTRACTS the `import "../style.css"` below
// into that file rather than injecting it at runtime, so a consumer resolving
// `@mulmoclaude/collection-plugin/vue` from node_modules will NOT auto-load the
// rules — the host must `import "@mulmoclaude/collection-plugin/style.css"`
// itself (see uiHost.ts). The import here only covers this package's own dev.
import "../style.css";

export { configureCollectionUi, collectionUi, type CollectionUi } from "./uiContext";
export { useCollectionRendering, type CollectionRendering } from "./useCollectionRendering";
export { default as CollectionRecordModal } from "./components/CollectionRecordModal.vue";
export { default as CollectionEmbedView } from "./components/CollectionEmbedView.vue";
export { default as CollectionCalendarView } from "./components/CollectionCalendarView.vue";
export { default as CollectionDayView } from "./components/CollectionDayView.vue";
export { default as CollectionKanbanView } from "./components/CollectionKanbanView.vue";
export { default as CollectionRecordPanel } from "./components/CollectionRecordPanel.vue";
