// Assemble one mobile (`target: "mobile"`) custom view for the remote client:
// find the view entry, read its HTML (source-aware staging read), pick its
// i18n dict for the requested locale, wrap it into the sandboxed srcdoc
// (CSP + postMessage bootstrap — @mulmoclaude/core/remote-view), and enforce
// the 1 MiB command-document budget. Shared by the `getRemoteView` channel
// handler and the desktop preview's HTTP route so both serve the IDENTICAL
// artifact (plans/feat-remote-custom-view.md, decision 2).
//
// Discriminated result (not throw) so the HTTP route can map each failure to
// its status; the channel handler converts non-ok to a thrown error via
// `remoteViewFailureMessage`. Factory keeps the mapping unit-testable with the
// engine stubbed.
import {
  buildRemoteViewSrcdoc,
  clampImageMaxEdge,
  pageFromItems,
  REMOTE_VIEW_ITEMS_MAX_BYTES,
  REMOTE_VIEW_MAX_BYTES,
  type RemoteViewItem,
  type RemoteViewMutateRequest,
  type RemoteViewPage,
  type RemoteViewPageRequest,
} from "@mulmoclaude/core/remote-view";
import { deriveAll } from "@mulmoclaude/core/collection";
import {
  deleteItem,
  listItems,
  readCustomViewHtml,
  readCustomViewI18n,
  readItem,
  safeRecordId,
  writeItem,
  type CollectionCustomView,
  type CollectionItem,
  type CollectionSchema,
  type LoadedCollection,
} from "./index.js";
import { resolveThumbnail } from "../../utils/files/thumbnail-store.js";

export interface RemoteViewInfo {
  id: string;
  label: string;
  icon?: string;
  target: "mobile";
}

export type RemoteViewBuildResult =
  | { kind: "ok"; view: RemoteViewInfo; srcdoc: string; bytes: number }
  | { kind: "view-not-found"; viewId: string }
  | { kind: "not-mobile"; viewId: string }
  | { kind: "file-missing"; file: string }
  | { kind: "too-large"; bytes: number };

export interface BuildRemoteViewDeps {
  readCustomViewHtml: typeof readCustomViewHtml;
  readCustomViewI18n: typeof readCustomViewI18n;
}

export const createBuildRemoteView =
  (deps: BuildRemoteViewDeps) =>
  async (collection: LoadedCollection, viewId: string, locale: string): Promise<RemoteViewBuildResult> => {
    const view = (collection.schema.views ?? []).find((entry) => entry.id === viewId);
    if (!view) return { kind: "view-not-found", viewId };
    // A desktop view's HTML assumes the token/dataUrl contract and would just
    // break on the phone — refuse it instead of serving a broken page.
    if (view.target !== "mobile") return { kind: "not-mobile", viewId };
    const html = await deps.readCustomViewHtml(collection, view.file);
    if (html === null) return { kind: "file-missing", file: view.file };
    const i18n = view.i18n ? await deps.readCustomViewI18n(collection, view.i18n, locale) : { locale: "", dict: {} };
    // `writable` gates the client-side updateItem/deleteItem install; the host
    // re-derives + enforces the actual policy on every mutate (createMutateRemoteView).
    const writable = isWritableView(view);
    const srcdoc = buildRemoteViewSrcdoc(html, { slug: collection.slug, locale: i18n.locale, dict: i18n.dict, writable });
    const bytes = Buffer.byteLength(srcdoc, "utf8");
    if (bytes > REMOTE_VIEW_MAX_BYTES) return { kind: "too-large", bytes };
    return { kind: "ok", view: { id: view.id, label: view.label, ...(view.icon ? { icon: view.icon } : {}), target: "mobile" }, srcdoc, bytes };
  };

export const buildRemoteView = createBuildRemoteView({ readCustomViewHtml, readCustomViewI18n });

/** One message per failure kind, shared by the channel handler (throws it) and
 *  the HTTP route (sends it with the matching status). */
export function remoteViewFailureMessage(result: Exclude<RemoteViewBuildResult, { kind: "ok" }>, slug: string): string {
  if (result.kind === "view-not-found") return `custom view '${result.viewId}' not found on collection '${slug}'`;
  if (result.kind === "not-mobile") return `custom view '${result.viewId}' is not a mobile view — declare target: "mobile" in its views[] entry`;
  if (result.kind === "file-missing") return `view file '${result.file}' not found — author it at data/skills/${slug}/${result.file}`;
  return `mobile view srcdoc is ${result.bytes} bytes — over the ${REMOTE_VIEW_MAX_BYTES}-byte command-channel budget; slim the HTML`;
}

// ── Mutate (phase 4 — plans/feat-remote-writable-view.md) ──
// A `target: "mobile"` view's update/delete, authorized by its OWN declared
// surface (editableFields / allowDelete) and enforced HOST-side — the client is
// never trusted. Shared by the `mutateRemoteViewItem` channel handler (phone)
// and the `…/remote-view/:viewId/mutate` HTTP route (desktop preview), so both
// transports apply identical policy. Discriminated result (not throw) mirrors
// the build result above.

/** True when a mobile view declared ANY write surface. Also gates the srcdoc's
 *  `writable` boot flag so the client only exposes methods the host will honor. */
function isWritableView(view: CollectionCustomView): boolean {
  return (view.editableFields?.length ?? 0) > 0 || view.allowDelete === true;
}

export type MutateRemoteViewResult =
  | { kind: "ok"; op: "update"; item: CollectionItem }
  | { kind: "ok"; op: "delete"; id: string }
  | { kind: "view-not-found"; viewId: string }
  | { kind: "not-mobile"; viewId: string }
  | { kind: "not-writable"; viewId: string }
  | { kind: "field-not-editable"; field: string }
  | { kind: "delete-not-allowed" }
  | { kind: "invalid-patch" }
  | { kind: "item-not-found"; id: string }
  | { kind: "invalid-id"; id: string }
  | { kind: "path-escape" };

export interface MutateRemoteViewDeps {
  readItem: typeof readItem;
  writeItem: typeof writeItem;
  deleteItem: typeof deleteItem;
}

export const createMutateRemoteView =
  (deps: MutateRemoteViewDeps) =>
  async (collection: LoadedCollection, viewId: string, request: RemoteViewMutateRequest): Promise<MutateRemoteViewResult> => {
    const view = (collection.schema.views ?? []).find((entry) => entry.id === viewId);
    if (!view) return { kind: "view-not-found", viewId };
    if (view.target !== "mobile") return { kind: "not-mobile", viewId };
    if (!isWritableView(view)) return { kind: "not-writable", viewId };
    return request.op === "delete"
      ? deleteViaView(deps, collection, view.allowDelete === true, request.id)
      : updateViaView(deps, collection, view.editableFields ?? [], request);
  };

async function deleteViaView(deps: MutateRemoteViewDeps, collection: LoadedCollection, allowDelete: boolean, itemId: string): Promise<MutateRemoteViewResult> {
  if (!allowDelete) return { kind: "delete-not-allowed" };
  const result = await deps.deleteItem(collection.dataDir, itemId, { slug: collection.slug });
  if (result.kind === "invalid-id") return { kind: "invalid-id", id: result.itemId };
  if (result.kind === "path-escape") return { kind: "path-escape" };
  if (result.kind === "not-found") return { kind: "item-not-found", id: result.itemId };
  return { kind: "ok", op: "delete", id: result.itemId };
}

async function updateViaView(
  deps: MutateRemoteViewDeps,
  collection: LoadedCollection,
  editableFields: string[],
  request: Extract<RemoteViewMutateRequest, { op: "update" }>,
): Promise<MutateRemoteViewResult> {
  const { primaryKey } = collection.schema;
  const patchKeys = Object.keys(request.patch);
  if (patchKeys.length === 0) return { kind: "invalid-patch" };
  const allowed = new Set(editableFields);
  // The primary key is never patchable (it is the record id — renaming it would
  // desync the file name from the record) even if an author listed it.
  const offending = patchKeys.find((key) => key === primaryKey || !allowed.has(key));
  if (offending) return { kind: "field-not-editable", field: offending };
  // Classify a bad id BEFORE readItem — which returns null for an unsafe id, a
  // path-escape, AND a genuinely-missing record alike — so update reports the
  // same explicit `invalid-id` the delete path does (via deleteItem) instead of
  // masking it as a 404. (A valid id whose dataDir escapes the workspace can
  // hold no record, so it still resolves to item-not-found; a real write is
  // additionally refused by writeItem's own containment guard below.)
  if (safeRecordId(request.id) === null) return { kind: "invalid-id", id: request.id };
  const existing = await deps.readItem(collection.dataDir, request.id, { slug: collection.slug });
  if (!existing) return { kind: "item-not-found", id: request.id };
  const merged: CollectionItem = { ...existing, ...request.patch, [primaryKey]: request.id };
  const result = await deps.writeItem(collection.dataDir, request.id, merged, { slug: collection.slug });
  if (result.kind === "invalid-id") return { kind: "invalid-id", id: result.itemId };
  if (result.kind === "path-escape") return { kind: "path-escape" };
  if (result.kind === "conflict") return { kind: "item-not-found", id: result.itemId }; // unreachable: refuseOverwrite is false
  return { kind: "ok", op: "update", item: result.item };
}

export const mutateRemoteView = createMutateRemoteView({ readItem, writeItem, deleteItem });

// ── Item pages with inlined image thumbnails (phase 5 — plans/feat-remote-view-images.md) ──
// A mobile view's `getItems`, view-aware so it can inline the `imageFields` its
// declaration whitelists: derive computed fields → slice/project (the phase-2
// page semantics) → replace each declared image-type field's workspace path with
// a downscaled `data:` URL thumbnail, within a per-page byte budget so the 1 MiB
// command doc is never risked. Shared by the `getRemoteViewItems` channel handler
// (phone) and the `…/remote-view/:viewId/items` HTTP route (desktop preview).

export type RemoteViewItemsResult =
  { kind: "ok"; page: RemoteViewPage; inlined: number; omitted: number } | { kind: "view-not-found"; viewId: string } | { kind: "not-mobile"; viewId: string };

export interface RemoteViewItemsDeps {
  listItems: typeof listItems;
  resolveThumbnail: typeof resolveThumbnail;
}

/** The declared image fields that are actually inlineable this page: image-type
 *  in the schema AND kept by the request's `fields` projection (a projection
 *  that dropped the column ships no image bytes). A declared non-image field is
 *  ignored, not an error. */
function inlineFields(view: CollectionCustomView, schema: CollectionSchema, requested: string[] | undefined): string[] {
  const declared = view.imageFields ?? [];
  if (declared.length === 0) return [];
  const kept = requested ? new Set([schema.primaryKey, ...requested]) : null;
  return declared.filter((name) => schema.fields[name]?.type === "image" && (kept === null || kept.has(name)));
}

/** Replace declared image paths with thumbnail `data:` URLs in place, stopping
 *  once the accumulated thumbnail bytes would exceed `budget` — a field left as
 *  its path (over budget, unresolvable, or already inlined) counts as `omitted`
 *  and the view renders it as a placeholder. */
async function inlineImages(
  items: RemoteViewItem[],
  fields: string[],
  maxEdge: number,
  deps: RemoteViewItemsDeps,
  budget: number,
): Promise<{ inlined: number; omitted: number }> {
  let used = 0;
  let inlined = 0;
  let omitted = 0;
  for (const item of items) {
    for (const field of fields) {
      const value = item[field];
      if (typeof value !== "string" || value.length === 0 || value.startsWith("data:")) continue;
      const dataUrl = used < budget ? await deps.resolveThumbnail(value, maxEdge) : null;
      if (dataUrl && used + dataUrl.length <= budget) {
        item[field] = dataUrl;
        used += dataUrl.length;
        inlined += 1;
      } else {
        omitted += 1;
      }
    }
  }
  return { inlined, omitted };
}

export const createRemoteViewItems =
  (deps: RemoteViewItemsDeps) =>
  async (collection: LoadedCollection, viewId: string, request: RemoteViewPageRequest): Promise<RemoteViewItemsResult> => {
    const view = (collection.schema.views ?? []).find((entry) => entry.id === viewId);
    if (!view) return { kind: "view-not-found", viewId };
    if (view.target !== "mobile") return { kind: "not-mobile", viewId };
    // Derive record-local formulas with an empty ref cache — same as the phase-2
    // channel handlers and the preview, so `getItems` numbers match the desktop.
    const derived = (await deps.listItems(collection.dataDir)).map((item) => deriveAll(collection.schema, item, {}) as RemoteViewItem);
    const page = pageFromItems(derived, request, collection.schema.primaryKey);
    const fields = inlineFields(view, collection.schema, request.fields);
    if (fields.length === 0) return { kind: "ok", page, inlined: 0, omitted: 0 };
    // Budget the thumbnails against what's left of the doc after the (tiny,
    // path-only) base JSON, so the serialized page stays under the cap.
    const budget = REMOTE_VIEW_ITEMS_MAX_BYTES - Buffer.byteLength(JSON.stringify(page), "utf8");
    const { inlined, omitted } = await inlineImages(page.items, fields, clampImageMaxEdge(view.imageMaxEdge), deps, Math.max(0, budget));
    return { kind: "ok", page, inlined, omitted };
  };

export const remoteViewItems = createRemoteViewItems({ listItems, resolveThumbnail });

/** Message per non-ok item-page kind — shared by the channel handler (throws)
 *  and the HTTP route (sends with the matching status). */
export function remoteViewItemsFailureMessage(result: Exclude<RemoteViewItemsResult, { kind: "ok" }>, slug: string): string {
  if (result.kind === "not-mobile") return `custom view '${result.viewId}' is not a mobile view — declare target: "mobile" in its views[] entry`;
  return `custom view '${result.viewId}' not found on collection '${slug}'`;
}

/** Message per non-ok mutate kind — shared by the channel handler (throws) and
 *  the HTTP route (sends with the matching status). */
export function mutateRemoteViewFailureMessage(result: Exclude<MutateRemoteViewResult, { kind: "ok" }>, slug: string): string {
  if (result.kind === "view-not-found") return `custom view '${result.viewId}' not found on collection '${slug}'`;
  if (result.kind === "not-mobile") return `custom view '${result.viewId}' is not a mobile view — declare target: "mobile" in its views[] entry`;
  if (result.kind === "not-writable")
    return `mobile view '${result.viewId}' is read-only — declare editableFields and/or allowDelete in its views[] entry to allow writes`;
  if (result.kind === "field-not-editable")
    return `field '${result.field}' is not editable from this view — add it to the view's editableFields (the primary key is never editable)`;
  if (result.kind === "delete-not-allowed") return `this view may not delete records — set allowDelete: true in its views[] entry`;
  if (result.kind === "invalid-patch") return `update patch must be a non-empty object of field changes`;
  if (result.kind === "item-not-found") return `item '${result.id}' not found in collection '${slug}'`;
  if (result.kind === "invalid-id") return `invalid item id: ${result.id}`;
  return `data directory for collection '${slug}' escapes the workspace`;
}
