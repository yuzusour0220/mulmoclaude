// Preset plugin loader (#1043 C-2 follow-up).
//
// Reads `server/plugins/preset-list.ts` at boot and resolves each
// entry against the package's installed location via Node's standard
// module-resolution (`import.meta.resolve`). The package is already
// laid out by `npm install` / `yarn install`; no tgz unpack step.
// The result is the same `RuntimePlugin` shape user-installed plugins
// produce, so both flows share the runtime registry, the dispatch
// route, and the asset route.
//
// Why not a hardcoded `node_modules/<pkg>` join: yarn workspaces
// hoist deps to the repo root, so the launcher sees the package in
// `<repo>/node_modules/...` while `<repo>/packages/mulmoclaude/node_modules/`
// is empty. `import.meta.resolve` walks the same way Node does at
// runtime, so it finds the package wherever the package manager put
// it. (npm's flat install doesn't have this issue — it lands under
// `<package>/node_modules/...` directly. Both work with the same
// resolver call.)
//
// Trust model: the package name comes from the server-side hardcoded
// preset list, not from user input. We trust the resolved path
// without an `ensureInsideBase` anchor because there is no base —
// the resolver returns wherever the package manager chose. The asset
// route's `realpathSync(plugin.cachePath)` still pins to whatever was
// resolved here at registration time; a route caller cannot redirect
// to a different path via URL params.
//
// Failures don't abort boot. A missing preset (install drift, rare)
// logs a warning; healthy presets still register.

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { PRESET_PLUGINS, type PresetPlugin } from "./preset-list.js";
import { loadPluginFromCacheDir, type LoaderDeps, type RuntimePlugin } from "./runtime-loader.js";
import { log } from "../system/logger/index.js";

const LOG_PREFIX = "plugins/preset";

// Anchored at this module so `require.resolve.paths(pkg)` returns the same
// list Node's own CJS resolver would search from here — parent walk plus
// NODE_PATH entries. See resolvePresetRoot below.
const localRequire = createRequire(import.meta.url);

interface PackageJsonShape {
  version?: string;
}

/** Resolve the on-disk root of a preset package. Delegates the search path
 *  list to Node's `require.resolve.paths(<pkg>)` so we stay in lockstep with
 *  the CJS resolver on every layout the installer might choose:
 *
 *    - yarn workspaces: deps hoisted to the repo root's `node_modules`
 *    - npm flat install: package's `node_modules` directly
 *    - npm nested install: under a parent package's `node_modules`
 *    - NODE_PATH fallback: the Docker sandbox mounts each
 *      `@mulmoclaude/*` workspace at `/app/pkg_modules/@mulmoclaude/<name>`
 *      and appends `/app/pkg_modules` to NODE_PATH so CJS resolution
 *      falls through when the primary `node_modules` link dangles inside
 *      the container (#1946 on Windows). The old hand-rolled parent-walk
 *      didn't consult NODE_PATH, silently dropping every preset — the
 *      #1982 gap this delegation closes.
 *
 *  Why the `existsSync` gate instead of `require.resolve('<pkg>/package.json')`:
 *  many packages (including `@gui-chat-plugin/*`) ship an `exports` field
 *  that doesn't expose `./package.json`, so the ESM/CJS resolver throws
 *  `ERR_PACKAGE_PATH_NOT_EXPORTED`. Doing the final `<dir>/<pkg>/package.json`
 *  check ourselves sidesteps the exports gate.
 *
 *  Exported for the POSIX-only unit test that pins the NODE_PATH fallback
 *  behavior (test/plugins/test_preset_loader_node_path.ts). */
export function resolvePresetRoot(packageName: string): string | null {
  const paths = localRequire.resolve.paths(packageName);
  if (!paths) return null;
  for (const dir of paths) {
    const candidate = path.join(dir, packageName);
    if (existsSync(path.join(candidate, "package.json"))) {
      return candidate;
    }
  }
  return null;
}

async function loadOnePreset(entry: PresetPlugin, deps: LoaderDeps = {}): Promise<RuntimePlugin | null> {
  const { packageName, devOnly } = entry;
  const cachePath = resolvePresetRoot(packageName);
  if (!cachePath) {
    // dev-only entries are knowingly absent from the published tarball;
    // surfacing them as warn would mislead `npx mulmoclaude` users.
    if (devOnly) {
      log.debug(LOG_PREFIX, "dev-only preset not present (expected on a published install)", { packageName });
    } else {
      log.warn(LOG_PREFIX, "preset package not resolvable — run `yarn install`?", { packageName });
    }
    return null;
  }
  const pkgJsonPath = path.join(cachePath, "package.json");
  let pkg: PackageJsonShape;
  try {
    pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as PackageJsonShape;
  } catch (err) {
    log.warn(LOG_PREFIX, "preset package.json read/parse failed", { packageName, error: String(err) });
    return null;
  }
  const { version } = pkg;
  if (typeof version !== "string" || version.length === 0) {
    log.warn(LOG_PREFIX, "preset package has no version", { packageName });
    return null;
  }
  return loadPluginFromCacheDir(packageName, version, cachePath, deps);
}

/** Load every preset declared in `server/plugins/preset-list.ts`.
 *  Returns the loaded set; failures are logged and silently
 *  skipped.
 *
 *  Pass `deps.runtimeFactory` from the parent server so factory-shape
 *  presets get a real runtime; the MCP child can omit it (definition-
 *  only). */
export async function loadPresetPlugins(deps: LoaderDeps = {}): Promise<RuntimePlugin[]> {
  if (PRESET_PLUGINS.length === 0) return [];
  const loaded: RuntimePlugin[] = [];
  for (const entry of PRESET_PLUGINS) {
    const plugin = await loadOnePreset(entry, deps);
    if (plugin) loaded.push(plugin);
  }
  log.info(LOG_PREFIX, "loaded", { requested: PRESET_PLUGINS.length, succeeded: loaded.length });
  return loaded;
}
