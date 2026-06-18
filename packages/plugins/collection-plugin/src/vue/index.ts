// @mulmoclaude/collection-plugin/vue — browser UI layer.
//
// The host frontend imports from here (the UI host binding, the rendering
// composable, and — as they move in — the View components). Configure the host
// binding once at app startup:
//   import { configureCollectionUi } from "@mulmoclaude/collection-plugin/vue";
//   configureCollectionUi({ fetchCollectionDetail, fileAssetUrl });

export { configureCollectionUi, collectionUi, type CollectionUi } from "./uiContext";
export { useCollectionRendering, type CollectionRendering } from "./useCollectionRendering";
