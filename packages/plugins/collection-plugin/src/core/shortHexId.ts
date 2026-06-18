/**
 * 8-char hex id — short, slug-safe, and editable. Produces the same id *shape*
 * as the server's `generateItemId()` (8 hex chars) so a UI-created collection
 * record looks like one the server would have generated for a form submitted
 * with a blank primary key. The source of randomness differs (UUID-derived here
 * vs `randomBytes` on the server); only the shape is intentionally shared.
 */
export function shortHexId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}
