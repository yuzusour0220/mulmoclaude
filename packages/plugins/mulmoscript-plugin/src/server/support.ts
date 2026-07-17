// Small server-side utilities, self-contained so the package works in any
// host. `resolveWithinRoot` is a faithful copy of MulmoClaude's
// realpath-based traversal check (server/utils/files/safe.ts) — the
// security-critical primitive must not drift per host, so it ships with the
// ops that depend on it.

import { realpathSync } from "fs";
import { readFile } from "node:fs/promises";
import path from "path";

export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err !== null && typeof err === "object") {
    const obj = err as { details?: unknown; message?: unknown };
    if (typeof obj.details === "string" && obj.details) return obj.details;
    if (typeof obj.message === "string" && obj.message) return obj.message;
  }
  return String(err);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stripDataUri(dataUri: string): string {
  return dataUri.replace(/^data:image\/[^;]+;base64,/, "");
}

/** Realpath-based containment: resolve `relPath` against the ROOT's
 *  realpath and require the target's realpath to stay inside it. Returns
 *  null on ENOENT or traversal (symlink escapes included). */
export function resolveWithinRoot(rootReal: string, relPath: string): string | null {
  const normalized = path.normalize(relPath || "");
  const resolved = path.resolve(rootReal, normalized);
  let resolvedReal: string;
  try {
    resolvedReal = realpathSync(resolved);
  } catch {
    return null;
  }
  if (resolvedReal !== rootReal && !resolvedReal.startsWith(rootReal + path.sep)) {
    return null;
  }
  return resolvedReal;
}

// Async so reading a large generated image/audio file doesn't stall the
// host's event loop (CodeRabbit on #2137).
export async function fileToDataUri(filePath: string, mimeType: string): Promise<string> {
  const data = await readFile(filePath);
  return `data:${mimeType};base64,${data.toString("base64")}`;
}
