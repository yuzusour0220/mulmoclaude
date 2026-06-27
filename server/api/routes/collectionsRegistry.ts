// Read endpoints for the curated collection registries (Discover tab). Backs
// `GET /api/collections-registry` by server-fetching every configured registry's
// published index.json (official receptron/mulmoclaude-collections plus any
// user-added entries from `config/collections-registries.json`) and returning
// merged entries. The host never exposes upstream URLs to the client; it proxies
// + caches each one.

import { Router, Request, Response } from "express";

import { API_ROUTES } from "../../../src/config/apiRoutes.js";
import { badRequest } from "../../utils/httpError.js";
import { fetchAllRegistries } from "../../workspace/collectionsRegistry/client.js";
import { previewCollection } from "../../workspace/collectionsRegistry/collectionFiles.js";
import { performImport } from "../../workspace/collectionsRegistry/importWriter.js";
import { performExport } from "../../workspace/collectionsRegistry/performExport.js";
import type { RegistryCollectionEntry } from "../../workspace/collectionsRegistry/registryIndex.js";
import { workspacePath } from "../../workspace/workspace.js";

const router = Router();

interface RegistrySummary {
  name: string;
  status: "ok" | "stale" | "failed";
  generatedAt: string | null;
  error: string | null;
  entryCount: number;
}

interface RegistryListResponse {
  /** Per-registry status for the UI to surface origin badges + per-registry
   *  errors without flooding the catalog with empty cards. */
  registries: RegistrySummary[];
  /** True iff at least one registry returned a stale-from-cache result; the UI
   *  shows a single banner instead of per-card stale indicators. */
  stale: boolean;
  collections: RegistryCollectionEntry[];
}

interface ErrorResponse {
  error: string;
}

router.get(API_ROUTES.collectionsRegistry.list, async (_req: Request, res: Response<RegistryListResponse | ErrorResponse>) => {
  const merged = await fetchAllRegistries();
  const registries: RegistrySummary[] = merged.map((reg) => ({
    name: reg.name,
    status: reg.status,
    generatedAt: reg.generatedAt,
    error: reg.error,
    entryCount: reg.entries.length,
  }));
  const collections = merged.flatMap((reg) => reg.entries);
  const stale = merged.some((reg) => reg.status === "stale");
  res.json({ registries, stale, collections });
});

interface RegistryPreviewResponse {
  entry: RegistryCollectionEntry;
  schema: Record<string, unknown>;
  meta: Record<string, unknown>;
}

router.get(API_ROUTES.collectionsRegistry.preview, async (req: Request, res: Response<RegistryPreviewResponse | ErrorResponse>) => {
  const author = typeof req.query.author === "string" ? req.query.author : "";
  const slug = typeof req.query.slug === "string" ? req.query.slug : "";
  const registry = typeof req.query.registry === "string" && req.query.registry ? req.query.registry : null;
  if (!author || !slug) {
    badRequest(res, "author and slug query params are required");
    return;
  }
  const result = await previewCollection(author, slug, registry);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json({ entry: result.entry, schema: result.schema, meta: result.meta });
});

interface ImportBody {
  author?: unknown;
  slug?: unknown;
  registry?: unknown;
}

interface ImportResponse {
  localSlug: string;
  updated: boolean;
  seedWritten: number;
  seedSkipped: boolean;
}

router.post(API_ROUTES.collectionsRegistry.import, async (req: Request<object, unknown, ImportBody>, res: Response<ImportResponse | ErrorResponse>) => {
  const author = typeof req.body.author === "string" ? req.body.author : "";
  const slug = typeof req.body.slug === "string" ? req.body.slug : "";
  const registry = typeof req.body.registry === "string" && req.body.registry ? req.body.registry : null;
  if (!author || !slug) {
    badRequest(res, "author and slug are required");
    return;
  }
  const result = await performImport(author, slug, workspacePath, registry);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json({ localSlug: result.localSlug, updated: result.updated, seedWritten: result.seedWritten, seedSkipped: result.seedSkipped });
});

interface ExportBody {
  slug?: unknown;
  author?: unknown;
  license?: unknown;
  includeSeed?: unknown;
}

interface ExportResponse {
  outputPath: string;
  fileCount: number;
  seedCount: number;
  seedSkipped: number;
  warnings: string[];
}

router.post(API_ROUTES.collectionsRegistry.export, async (req: Request<object, unknown, ExportBody>, res: Response<ExportResponse | ErrorResponse>) => {
  const slug = typeof req.body.slug === "string" ? req.body.slug : "";
  const author = typeof req.body.author === "string" ? req.body.author : "";
  if (!slug || !author) {
    badRequest(res, "slug and author are required");
    return;
  }
  const license = typeof req.body.license === "string" && req.body.license ? req.body.license : "MIT";
  const includeSeed = req.body.includeSeed === true;
  const result = await performExport(slug, { author, license, includeSeed }, workspacePath);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json({
    outputPath: result.outputPath,
    fileCount: result.fileCount,
    seedCount: result.seedCount,
    seedSkipped: result.seedSkipped,
    warnings: result.warnings,
  });
});

export default router;
