# Extract presentCollection + collection engine → @mulmoclaude/collection-plugin

Goal: package the Collections feature so MulmoTerminal can import it like `@mulmoclaude/chart-plugin`.

## Status

**Shipped in PR #1723** (`@mulmoclaude/collection-plugin@0.2.1`, published):

- ✅ **1a** — isomorphic engine (`derivedFormula`, `deriveAll`, `actionVisible`) → package `.`; removed the server→`src/` reach-in.
- ✅ **1b** — canonical schema types consolidated into the package core; server `types.ts` + frontend `collectionTypes.ts` re-export. Feeds decoupled (`IngestSpec extends CollectionIngest`).
- ✅ **1b-rest** — remaining pure utils (`sortItems`, `itemLabel`, `calendarGrid`) → core.
- ✅ **1c** — full server engine → `./server` entry behind `configureCollectionHost({ workspaceRoot, log, paths, isPresetSlug })`:
  - 1c-i: host binding + `paths`
  - 1c-ii: `io` + `validate` + `LoadedCollection` + atomic-write port
  - 1c-iii: `discovery` (+ zod) + `templatePath`; binding extended with skills/feeds path helpers; ingest vocab moved into the schema
  - 1c-iv/v: `derive` / `spawn` / `delete` / `views`
  - host-integration stays host-side: `notifications`, `watcher`, `api/routes/collections.ts`, `manageCollection.ts`
- ✅ **1d-core** — `presentCollection` tool definition + pure executor → package `.` (gui-chat-protocol peer dep).
- ✅ **1d step 1** — UI view-state types + `enumColors` + `draft` → core; host `collectionTypes.ts` owns no types now. `enumColors`/`draft` reached by host components via thin re-export shims (removed when components move).

## Remaining — the collection frontend (1d-View + Phase 2)

The card View (`CollectionView`, 2,131 LOC) + 7 sub-components + `useCollectionRendering` + the
browsable `/collections` pages are one tightly-coupled unit, gated on a **`CollectionUiContext`**
injection layer (provided via Vue `provide`; host supplies it, MulmoTerminal supplies its own):

- `fetchCollectionDetail(slug)` + the CRUD ops (replaces `apiGet`/`apiPost`/`apiPut`/`apiDelete` + `API_ROUTES`)
- `fileAssetUrl(value)` + `customViewUrl(...)` (replaces `htmlPreviewUrlFor`/`svgPreviewUrlFor`/`isValidFilePath` + the capability-token iframe URL — folded in here, so **no gui-chat-protocol `assetUrl` primitive / extra publish needed**)
- `navigate` (router `push`/`replace` + `PAGE_ROUTES`) — for the browsable pages
- `sendMessage` / `startNewChat` (`useAppApi`), `confirm` (`useConfirm`), `pin` (`useShortcuts`), `notify` (`useNotifications`)
- generic UI (`ConfirmModal`, `PinToggle`) — injected or moved

### Sequence (each its own green commit)
1. `CollectionUiContext` interface + host provider + move `useCollectionRendering` onto it.
2. Move `CollectionView` + sub-components → package `./vue`, host imports replaced by the context. Remove the `enumColors`/`draft` shims.
3. Browsable pages (`CollectionsIndexView`, `/collections` route) → package + host router wiring.
4. Plugin `./vue` entry (View + Preview + lang); shrink the host `presentCollection` adapter; final version bump + publish.

## Publish gate
The launcher pins `@mulmoclaude/collection-plugin@^0.2.x`; bump + republish before each PR/smoke run
so the clean-install resolves the current content (0.2.0 → 0.2.1 already done this PR).
