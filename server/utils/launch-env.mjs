// Launcher-side `.env` loading for `npx mulmoclaude`.
//
// The server's workspace (`~/mulmoclaude`, see server/workspace/paths.ts)
// is an isolated, agent-managed data space — "the workspace is the
// database". Secrets like an API key must NOT live there. So a user's
// `.env` belongs in the directory they launch from; the launcher loads
// it here and forwards the values to the spawned server via its
// environment. Launch dir (config/secrets) and workspace (data) are
// decoupled on purpose.
//
// Plain `.mjs` (with a sibling `.d.mts`) because the launcher runs
// BEFORE tsx is wired up, so it can't import a `.ts` file — same reason
// as port.mjs / cli-flags.mjs.

import { readFileSync as fsReadFileSync } from "fs";
import { parse as dotenvParse } from "dotenv";

// Read + parse a `.env` file. Never throws on a missing / unreadable
// file — returns `{ exists: false, parsed: {} }` so the caller no-ops.
// The `readFileSync` / `parse` seams exist so the pure logic is unit
// testable without touching the real filesystem.
export function parseEnvFile(filePath, { readFileSync = fsReadFileSync, parse = dotenvParse } = {}) {
  let contents;
  try {
    contents = readFileSync(filePath, "utf8");
  } catch {
    return { exists: false, parsed: {} };
  }
  return { exists: true, parsed: parse(contents) };
}

// Merge parsed `.env` values onto a base environment WITHOUT overriding
// keys already present in the base — an exported shell var wins over the
// file (dotenv's no-override semantics). Pure: returns a new object and
// never mutates `baseEnv`. `loadedKeys` = keys taken from the file,
// `skippedKeys` = file keys the shell already defined.
export function mergeLaunchEnv(baseEnv, parsed) {
  const env = { ...baseEnv };
  const loadedKeys = [];
  const skippedKeys = [];
  for (const [key, value] of Object.entries(parsed)) {
    const shellDefined = Object.prototype.hasOwnProperty.call(baseEnv, key) && baseEnv[key] !== undefined;
    if (shellDefined) {
      skippedKeys.push(key);
      continue;
    }
    env[key] = value;
    loadedKeys.push(key);
  }
  return { env, loadedKeys, skippedKeys };
}
