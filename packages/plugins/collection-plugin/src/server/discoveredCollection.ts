import type { CollectionSchema, CollectionSource } from "../core/schema";

/** A collection discovered + loaded from disk: its schema plus the resolved
 *  on-disk locations. Produced by the host's discovery layer (which supplies
 *  the workspace scan) and consumed by the storage / validation engine.
 *
 *  The host's `discovery.ts` re-exports this type so its many existing
 *  importers keep resolving it from there. */
export interface LoadedCollection {
  slug: string;
  source: CollectionSource;
  schema: CollectionSchema;
  /** Absolute path to the resolved dataPath directory (inside the workspace).
   *  May not exist yet — the data folder is created on first write. */
  dataDir: string;
  /** Absolute path to the skill directory this collection was loaded from
   *  (`<skillsRoot>/<slug>/`). Action templates are read from here, path-safely. */
  skillDir: string;
}
