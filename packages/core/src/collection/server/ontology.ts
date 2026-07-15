// The machine-readable workspace ontology (plan step ① of
// plans/collection-ontology.md): one entry per discovered collection with
// the identity + relationship facts an agent needs to reason ACROSS
// collections — which slugs exist, how they point at each other, how big
// they are — without re-reading every schema.json. Derived on demand from
// the schemas (no authoring, no storage), so it can never go stale.
// Deliberately NOT a unified schema: collections stay bounded contexts;
// semantic joining happens at read time in the caller.

import { readdir } from "node:fs/promises";
import { discoverCollections, type DiscoveryOptions } from "./discovery";
import { isContainedInRoot } from "./paths";
import { getWorkspaceRoot } from "./host";
import type { LoadedCollection } from "./discoveredCollection";
import type { CollectionSchema } from "../core/schema";

/** One outbound relationship a schema declares: a `ref` (the record
 *  stores the target's primaryKey slug) or `embed` (display-only pull)
 *  pointing at collection `to`. A `ref` column inside a `table` field is
 *  reported with a dotted path (`lines.clientId`). Whether `to` exists is
 *  NOT checked — resolution is fail-soft at render, and the caller holds
 *  the full slug list to compare against anyway. */
export interface OntologyRelation {
  field: string;
  kind: "ref" | "embed";
  to: string;
}

export interface CollectionOntologyEntry {
  slug: string;
  title: string;
  icon: string;
  primaryKey: string;
  /** The effective display field: the schema's `displayField`, falling
   *  back to the primaryKey exactly as render-time labelling does. */
  displayField: string;
  recordCount: number;
  relations: OntologyRelation[];
}

/** Extract the outbound relations a schema declares, in field
 *  declaration order: top-level `ref` / `embed` fields plus `ref`
 *  sub-fields inside `table` columns. Pure — exported so the phase-2
 *  graph panel can reuse it on already-loaded schemas. */
export function schemaRelations(schema: CollectionSchema): OntologyRelation[] {
  const relations: OntologyRelation[] = [];
  for (const [key, spec] of Object.entries(schema.fields)) {
    if (spec.type === "ref" || spec.type === "embed") relations.push({ field: key, kind: spec.type, to: spec.to });
    if (spec.type !== "table") continue;
    for (const [subKey, subSpec] of Object.entries(spec.of)) {
      if (subSpec.type === "ref") relations.push({ field: `${key}.${subKey}`, kind: "ref", to: subSpec.to });
    }
  }
  return relations;
}

/** Count the record files in a collection's data dir — the same
 *  `<id>.json` entries `listItems` considers, WITHOUT parsing them (the
 *  ontology is a summary; a malformed record is still a record). Dirent
 *  `isFile()` mirrors `listItems`' lstat file-disclosure defense: a
 *  symlinked record is skipped there, so it must not count here either
 *  (Codex review on PR #2099). Fail-soft: a missing dir or a dataDir
 *  escaping the workspace via symlink counts 0. */
async function countRecordFiles(dataDir: string, workspaceRoot: string): Promise<number> {
  if (!isContainedInRoot(dataDir, workspaceRoot)) return 0;
  try {
    const entries = await readdir(dataDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith(".")).length;
  } catch {
    return 0;
  }
}

async function toOntologyEntry(collection: LoadedCollection, workspaceRoot: string): Promise<CollectionOntologyEntry> {
  const { schema } = collection;
  return {
    slug: collection.slug,
    title: schema.title,
    icon: schema.icon,
    primaryKey: schema.primaryKey,
    displayField: schema.displayField ?? schema.primaryKey,
    recordCount: await countRecordFiles(collection.dataDir, workspaceRoot),
    relations: schemaRelations(schema),
  };
}

/** Build the workspace ontology: every discovered collection (slug-sorted,
 *  discovery's order), each with its outbound relations and a
 *  readdir-cheap record count — fine to call on demand. */
export async function buildWorkspaceOntology(opts: DiscoveryOptions = {}): Promise<CollectionOntologyEntry[]> {
  const workspaceRoot = opts.workspaceRoot ?? getWorkspaceRoot();
  const collections = await discoverCollections(opts);
  return Promise.all(collections.map((collection) => toOntologyEntry(collection, workspaceRoot)));
}
