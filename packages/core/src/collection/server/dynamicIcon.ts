// Server-side compute for a collection's dynamic launcher-shortcut icon
// (see `CollectionSchema.dynamicIcon`). Wraps the pure resolver in
// `../core/dynamicIcon` with the one bit of I/O it needs: loading the
// source collection's raw stored records.

import { firstDateField, resolveIcon, selectDynamicRecord } from "../core/dynamicIcon";
import { loadCollection, type DiscoveryOptions } from "./discovery";
import { listItems } from "./io";
import { log } from "./host";
import type { LoadedCollection } from "./discoveredCollection";

/** Compute the effective launcher icon for `collection`: its static
 *  `schema.icon` when it declares no `dynamicIcon`, else the icon
 *  resolved from `dynamicIcon.source`'s RAW stored records (no
 *  derive/enrich — the icon rules match against stored values) via the
 *  pure resolver. Fails soft on any read/discovery error (missing source
 *  collection, filesystem error): falls back to `dynamicIcon.fallback ??
 *  schema.icon` rather than surfacing to the collections list. */
export async function computeCollectionIcon(collection: LoadedCollection, opts: DiscoveryOptions = {}): Promise<string> {
  const { schema } = collection;
  const spec = schema.dynamicIcon;
  if (!spec) return schema.icon;
  try {
    const source = await loadCollection(spec.source.collection, opts);
    if (!source) return spec.fallback ?? schema.icon;
    const items = await listItems(source.dataDir, { workspaceRoot: opts.workspaceRoot });
    const orderBy = spec.source.orderBy ?? firstDateField(source.schema);
    return resolveIcon(selectDynamicRecord(items, spec.source, orderBy), spec, schema.icon);
  } catch (err) {
    log.warn("collections", "dynamic icon compute failed, falling back", {
      slug: collection.slug,
      source: spec.source.collection,
      error: String(err),
    });
    return spec.fallback ?? schema.icon;
  }
}
