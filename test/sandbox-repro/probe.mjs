// Windows + Docker sandbox regression probe (#1946 / #1982).
//
// This script runs INSIDE a Linux Docker container spawned from a Windows
// host by `.github/workflows/docker_sandbox_windows.yaml`. It reproduces
// the exact bind-mount layout the mulmoclaude sandbox uses and asserts
// that both the environment reproduces the bug (the primary junction
// dangles) and that the NODE_PATH fallback pattern resolves preset
// packages correctly.
//
// Self-contained: no server code imports, no yarn build needed. The
// resolver patterns are inlined so the probe verifies the ENVIRONMENT
// works with the fix pattern; a companion POSIX unit test
// (test/plugins/test_preset_loader_node_path.ts) verifies that the
// production `resolvePresetRoot()` uses the pattern.
//
// Runs on: node:22-slim (no extra deps). Passes when the sandbox mount
// layout + NODE_PATH env correctly serves the four preset packages
// declared in server/plugins/preset-list.ts.

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const localRequire = createRequire(import.meta.url);

let failures = 0;
function step(name, check) {
  try {
    check();
    console.log(`  ok    ${name}`);
  } catch (err) {
    failures++;
    console.log(`  FAIL  ${name}\n        ${err.message}`);
  }
}

// The buggy `resolvePresetRoot` — matches server/plugins/preset-loader.ts
// BEFORE PR #1982's fix. Parent-walk only, never checks NODE_PATH. In
// this container it MUST return null for @mulmoclaude/* preset packages
// (proving we're reproducing the bug's environment).
function resolvePresetRoot_buggy(packageName, startDir) {
  let dir = startDir;
  while (true) {
    const candidate = path.join(dir, "node_modules", packageName);
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// The fixed `resolvePresetRoot` — delegates to Node's own resolver path
// list, which includes both the parent walk AND NODE_PATH entries. Same
// shape as the production code lands in server/plugins/preset-loader.ts
// after PR #1982's fix.
function resolvePresetRoot_fixed(packageName) {
  const paths = localRequire.resolve.paths(packageName);
  if (!paths) return null;
  for (const dir of paths) {
    const candidate = path.join(dir, packageName);
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
  }
  return null;
}

// ── 1. Environment sanity — the sandbox mount layout ──────────────────

// Primary node_modules MUST contain the dangling junction. When we bind
// mount the Windows host's node_modules into the Linux container, the
// @mulmoclaude/* entries are absolute NTFS junctions pointing at Windows
// paths that don't exist inside the container → existsSync returns false.
// If this check fails ("junction did not dangle"), the workflow's mount
// setup isn't reproducing the bug environment and everything below is
// meaningless.
step("primary /app/node_modules/@mulmoclaude/x-plugin dangles inside the container", () => {
  const primary = "/app/node_modules/@mulmoclaude/x-plugin/package.json";
  if (existsSync(primary)) {
    throw new Error("primary path resolves — junction did not dangle, env not reproducing #1946");
  }
});

// The PR #1974 workspace-module fallback root MUST be mounted with the
// preset packages readable. This is the escape hatch NODE_PATH resolution
// uses when the primary link dangles.
step("fallback /app/pkg_modules/@mulmoclaude/x-plugin/package.json is present", () => {
  const fallback = "/app/pkg_modules/@mulmoclaude/x-plugin/package.json";
  if (!existsSync(fallback)) throw new Error("fallback mount missing from container");
});

// ── 2. Node's built-in CJS resolver — confirms #1946 fix is intact ────

step("Node CJS require() resolves @mulmoclaude/x-plugin via NODE_PATH", () => {
  const resolved = localRequire.resolve("@mulmoclaude/x-plugin");
  if (!resolved.startsWith("/app/pkg_modules/")) {
    throw new Error(`resolved to unexpected path: ${resolved}`);
  }
});

// ── 3. resolvePresetRoot behavior — the #1982 gap ─────────────────────

// The buggy walker MUST return null here. If it returns a real path, the
// environment isn't reproducing the parent-walk-only failure mode and the
// fixed-version test below is meaningless.
step("buggy resolvePresetRoot returns null for @mulmoclaude/spotify-plugin (reproduces #1982)", () => {
  const resolved = resolvePresetRoot_buggy("@mulmoclaude/spotify-plugin", "/app/server/plugins");
  if (resolved !== null) throw new Error(`buggy walker unexpectedly resolved to ${resolved}`);
});

// The fixed pattern MUST find the fallback mount for every preset in the
// preset-list. If one fails, the fix is insufficient (e.g. the workflow
// forgot to mount that particular preset).
for (const pkg of ["@mulmoclaude/x-plugin", "@mulmoclaude/spotify-plugin", "@mulmoclaude/debug-plugin", "@mulmoclaude/core"]) {
  step(`fixed resolvePresetRoot finds ${pkg} via NODE_PATH`, () => {
    const resolved = resolvePresetRoot_fixed(pkg);
    if (resolved === null) throw new Error(`fixed pattern returned null — fallback path did not resolve`);
    if (!resolved.startsWith("/app/pkg_modules/")) throw new Error(`resolved outside fallback root: ${resolved}`);
  });
}

// Negative case: a made-up preset name MUST return null so we know the
// resolver isn't returning false positives.
step("fixed resolvePresetRoot returns null for a non-existent preset name", () => {
  const resolved = resolvePresetRoot_fixed("@mulmoclaude/definitely-does-not-exist-plugin");
  if (resolved !== null) throw new Error(`fixed pattern returned ${resolved} for a non-existent package`);
});

// ──────────────────────────────────────────────────────────────────────

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
