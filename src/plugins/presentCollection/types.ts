/** Render payload carried in the tool result's `data` field. The View
 *  mounts `<CollectionView>` keyed off these — the live collection
 *  schema + items are fetched client-side via the existing
 *  `/api/collections/...` routes, so only the addressing travels here. */
export interface PresentCollectionData {
  /** Slug of the collection to display (e.g. "clients", "invoices"). */
  collectionSlug: string;
  /** Optional primary-key value of a single item to open on mount. */
  itemId?: string;
}

/** Tool arguments — same shape as the render payload. */
export type PresentCollectionArgs = PresentCollectionData;
