// MulmoScript generation publisher — fans every generation start/finish out
// to BOTH channels:
//
//  1. the per-session `pendingGenerations` channel (`publishGeneration`,
//     session-store) that drives the cross-session sidebar indicator, and
//  2. the GENERIC plugin pubsub channel `plugin:mulmoScript:generation`
//     that the extracted @mulmoclaude/mulmoscript-plugin View subscribes
//     to for spinners + reload-on-finish (it replaced both the SSE
//     progress stream and the host-only `useActiveSession()` watcher).
//
// Also keeps the process-local in-flight map that backs the View's
// mount-time `pendingGenerations` dispatch snapshot — a View mounted
// mid-generation needs current state, which fire-and-forget pubsub events
// can't provide.
//
// Wired at boot via `initMulmoScriptGenerationPublisher` (same shape as
// `initFileChangePublisher`); publishes before init are session-only.

import type { IPubSub } from "./pub-sub/index.js";
import { publishGeneration } from "./session-store/index.js";
import { pluginChannelName } from "../plugins/runtime.js";
import { generationKey, type GenerationKind } from "../../src/types/events.js";

/** Matches the plugin's `MulmoScriptGenerationEvent` contract
 *  (packages/plugins/mulmoscript-plugin/src/core/contract.ts). */
export interface MulmoScriptGenerationSnapshotEntry {
  kind: GenerationKind;
  filePath: string;
  key: string;
  done: boolean;
  error?: string;
}

/** Scope name — matches `wrapWithScope("mulmoScript", …)` in
 *  `src/plugins/presentMulmoScript/index.ts`, which is what the View's
 *  `useRuntime().pubsub` subscribes under. */
const MULMOSCRIPT_SCOPE = "mulmoScript";
const GENERATION_EVENT = "generation";

let pubsubInstance: IPubSub | null = null;
const inFlight = new Map<string, { kind: GenerationKind; filePath: string; key: string }>();

export function initMulmoScriptGenerationPublisher(instance: IPubSub): void {
  pubsubInstance = instance;
}

/**
 * Publish one generation transition. `chatSessionId` may be undefined
 * (dispatch callers without a session, MulmoTerminal) — the session
 * channel no-ops but the plugin channel and the snapshot still fire, so
 * the View stays live either way.
 */
export function publishMulmoGeneration(
  chatSessionId: string | undefined,
  kind: GenerationKind,
  filePath: string,
  key: string,
  finished: boolean,
  error?: string,
): void {
  publishGeneration(chatSessionId, kind, filePath, key, finished, error);
  const mapKey = generationKey(kind, filePath, key);
  if (finished) {
    inFlight.delete(mapKey);
  } else {
    inFlight.set(mapKey, { kind, filePath, key });
  }
  const event: MulmoScriptGenerationSnapshotEntry = { kind, filePath, key, done: finished, ...(error ? { error } : {}) };
  pubsubInstance?.publish(pluginChannelName(MULMOSCRIPT_SCOPE, GENERATION_EVENT), event);
}

/** Snapshot of generations currently in flight for one script — the
 *  View's mount-time catch-up, filtered to its wire `filePath`. */
export function pendingMulmoGenerations(filePath: string): MulmoScriptGenerationSnapshotEntry[] {
  return [...inFlight.values()].filter((entry) => entry.filePath === filePath).map((entry) => ({ ...entry, done: false }));
}

/** Test-only — clear module state so each test starts clean. */
export function _resetMulmoScriptGenerationForTesting(): void {
  pubsubInstance = null;
  inFlight.clear();
}
