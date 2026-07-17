// Storage abstraction over a collection's records — the one seam where
// "where do the rows come from" is decided. Two implementations:
//
//   - file store: the classic `<dataDir>/<itemId>.json` records (io.ts),
//     writable through the governed write paths;
//   - CSV store (csvStore.ts): the rows of an external `dataSource` file,
//     queried through DuckDB — READ-ONLY by definition.
//
// Callers that only need to read records go through `storeFor(...)`;
// write paths keep calling `writeItem`/`deleteItem` directly but MUST
// refuse read-only collections first (`collectionWritable`) — the store
// deliberately exposes no write methods, so a "write through the store"
// can't be authored by accident.

import type { CollectionItem } from "../core/schema";
import { isReadOnlySchema } from "../core/schema";
import type { LoadedCollection } from "./discoveredCollection";
import { listItems, readItem, type IoOptions } from "./io";
import { csvList, csvRead } from "./csvStore";

export interface CollectionStoreCapabilities {
  readonly writable: boolean;
}

export interface CollectionStore {
  readonly capabilities: CollectionStoreCapabilities;
  /** Every record. CSV store: capped at `MAX_CSV_ROWS` (see csvStore.ts). */
  list: () => Promise<CollectionItem[]>;
  /** One record by id, or null when missing/invalid. */
  read: (itemId: string) => Promise<CollectionItem | null>;
}

/** True when the collection accepts UI/tool writes. A `dataSource`
 *  collection is read-only: updates happen by editing/replacing the
 *  data file itself. Every write entry point checks this BEFORE calling
 *  `writeItem`/`deleteItem` — server-enforced, not just UI-hidden. */
export function collectionWritable(collection: Pick<LoadedCollection, "schema">): boolean {
  return !isReadOnlySchema(collection.schema);
}

/** The one-line refusal write paths surface (HTTP 405 / MCP error text). */
export function readOnlyRefusal(slug: string): string {
  return `collection '${slug}' is read-only (backed by an external dataSource) — update the data file itself instead`;
}

/** Pick the store implementation for a discovered collection. A
 *  `dataSource` schema whose `dataSourceFile` failed to resolve yields a
 *  read-only EMPTY store rather than falling back to the (writable) file
 *  store — a half-loaded read-only collection must never become writable. */
export function storeFor(collection: LoadedCollection, opts: IoOptions = {}): CollectionStore {
  if (isReadOnlySchema(collection.schema)) {
    const file = collection.dataSourceFile;
    const key = collection.schema.primaryKey;
    return {
      capabilities: { writable: false },
      list: () => (file === undefined ? Promise.resolve([]) : csvList(file, key)),
      read: (itemId: string) => (file === undefined ? Promise.resolve(null) : csvRead(file, key, itemId)),
    };
  }
  return {
    capabilities: { writable: true },
    list: () => listItems(collection.dataDir, opts),
    read: (itemId: string) => readItem(collection.dataDir, itemId, opts),
  };
}
