// MulmoClaude's built-in "mulmoScript" dispatch handler (phase 2 of
// plans/feat-mulmoscript-plugin.md). The extracted
// @mulmoclaude/mulmoscript-plugin View reaches every backend through
// `useRuntime().dispatch({ kind, … })`; this module routes those kinds onto
// the SAME cores the legacy REST routes use (`mulmo-script-ops.ts` +
// the package's phase-1 save/update executes), so the two surfaces cannot
// drift. Imported for side effect at boot (server/index.ts).
//
// Response contract: every kind resolves to an `{ ok: … }` envelope
// (see the package's `core/contract.ts`) — business failures are data,
// not thrown errors, so user-facing messages stay free of the dispatch
// route's "plugin execute failed" prefix.

import { executeMulmoScriptSave, executeUpdateBeat, executeUpdateScript, type MulmoScriptFailure } from "@mulmoclaude/mulmoscript-plugin";
import {
  beatAudioOp,
  beatImageOp,
  beatMovieOp,
  characterImageOp,
  generateBeatAudioOp,
  generateMovieOp,
  generatePdfOp,
  guardStoryWirePath,
  movieStatusOp,
  pdfStatusOp,
  renderBeatOp,
  renderCharacterOp,
  uploadBeatImageOp,
  uploadCharacterImageOp,
  type OpFailure,
} from "../api/routes/mulmo-script-ops.js";
import { pendingMulmoGenerations } from "../events/mulmoscript-generation.js";
import { makeArtifactsFileOps } from "./runtime.js";
import { registerBuiltinDispatch } from "./builtin-dispatch.js";

/** Scope name — matches `wrapWithScope("mulmoScript", …)` in
 *  `src/plugins/presentMulmoScript/index.ts`, which is what the View's
 *  `useRuntime().dispatch` uses as the `:pkg` path segment. */
const MULMOSCRIPT_SCOPE = "mulmoScript";

interface DispatchFailure {
  ok: false;
  code: "bad_request" | "not_found" | "server_error";
  error: string;
}

function fromOpFailure(failure: OpFailure): DispatchFailure {
  // "unavailable" (ffmpeg missing) has no slot in the package contract's
  // code union — the View only reads `error`, so fold it into
  // server_error rather than widening the shared contract for one host.
  const code = failure.code === "unavailable" ? "server_error" : failure.code;
  return { ok: false, code, error: failure.error };
}

function fromPackageFailure(failure: MulmoScriptFailure): DispatchFailure {
  return { ok: false, code: failure.code, error: failure.error };
}

function invalidArgs(kind: string): DispatchFailure {
  return { ok: false, code: "bad_request", error: `invalid arguments for mulmoScript dispatch kind "${kind}"` };
}

function makeExecuteContext() {
  return { files: { artifacts: makeArtifactsFileOps() } };
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

// Beat indexes must be non-negative integers — reject `-1` / `1.5` at the
// dispatch boundary so invalid client input surfaces as a deterministic
// bad_request instead of leaking into beat-indexed ops (where it would
// index undefined beats and bubble up as server_error). Codex review.
function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

interface BeatArgs {
  filePath: string;
  beatIndex: number;
}

interface KeyArgs {
  filePath: string;
  key: string;
}

/** Pass ok results through untouched; normalize failures for the wire. */
function envelope<T>(result: ({ ok: true } & T) | OpFailure): ({ ok: true } & T) | DispatchFailure {
  return result.ok ? result : fromOpFailure(result);
}

function beatArgs(args: Record<string, unknown>): BeatArgs | null {
  const filePath = str(args.filePath);
  const beatIndex = num(args.beatIndex);
  if (!filePath || beatIndex === undefined) return null;
  return { filePath, beatIndex };
}

function keyArgs(args: Record<string, unknown>): KeyArgs | null {
  const filePath = str(args.filePath);
  const key = str(args.key);
  if (!filePath || !key) return null;
  return { filePath, key };
}

async function saveKind(args: Record<string, unknown>): Promise<unknown> {
  // Realpath symlink containment before the package's lexical guard —
  // see guardStoryWirePath in mulmo-script-ops.ts (Codex P1 on #2133).
  const guard = guardStoryWirePath(args.filePath);
  if (guard) return fromOpFailure(guard);
  const outcome = await executeMulmoScriptSave(makeExecuteContext(), {
    script: args.script,
    filename: str(args.filename),
    filePath: str(args.filePath),
  });
  if (!outcome.ok) return fromPackageFailure(outcome);
  return { ok: true, script: outcome.script, filePath: outcome.filePath, message: outcome.message };
}

async function updateKind(kind: "updateBeat" | "updateScript", args: Record<string, unknown>): Promise<unknown> {
  const guard = guardStoryWirePath(args.filePath);
  if (guard) return fromOpFailure(guard);
  const outcome = kind === "updateBeat" ? await executeUpdateBeat(makeExecuteContext(), args) : await executeUpdateScript(makeExecuteContext(), args);
  return outcome.ok ? { ok: true } : fromPackageFailure(outcome);
}

const STATUS_OPS = { movieStatus: movieStatusOp, pdfStatus: pdfStatusOp } as const;
const BEAT_PROBE_OPS = { beatImage: beatImageOp, beatAudio: beatAudioOp, beatMovie: beatMovieOp } as const;

async function probeKind(kind: string, args: Record<string, unknown>): Promise<unknown> {
  const statusOp = STATUS_OPS[kind as keyof typeof STATUS_OPS];
  if (statusOp) {
    const filePath = str(args.filePath);
    return filePath ? envelope(await statusOp(filePath)) : invalidArgs(kind);
  }
  if (kind === "characterImage") {
    const parsed = keyArgs(args);
    return parsed ? envelope(await characterImageOp(parsed.filePath, parsed.key)) : invalidArgs(kind);
  }
  const parsed = beatArgs(args);
  if (!parsed) return invalidArgs(kind);
  return envelope(await BEAT_PROBE_OPS[kind as keyof typeof BEAT_PROBE_OPS](parsed.filePath, parsed.beatIndex));
}

async function generateKind(kind: string, args: Record<string, unknown>): Promise<unknown> {
  const chatSessionId = str(args.chatSessionId);
  const force = args.force === true;
  if (kind === "generateMovie" || kind === "generatePdf") {
    const filePath = str(args.filePath);
    if (!filePath) return invalidArgs(kind);
    const result = kind === "generateMovie" ? await generateMovieOp(filePath, chatSessionId) : await generatePdfOp(filePath, chatSessionId);
    return result.ok ? result : fromOpFailure(result);
  }
  if (kind === "renderCharacter") {
    const parsed = keyArgs(args);
    if (!parsed) return invalidArgs(kind);
    const result = await renderCharacterOp({ ...parsed, force, chatSessionId });
    return result.ok ? result : fromOpFailure(result);
  }
  const parsed = beatArgs(args);
  if (!parsed) return invalidArgs(kind);
  const result =
    kind === "renderBeat" ? await renderBeatOp({ ...parsed, force, chatSessionId }) : await generateBeatAudioOp({ ...parsed, force, chatSessionId });
  return result.ok ? result : fromOpFailure(result);
}

async function uploadKind(kind: string, args: Record<string, unknown>): Promise<unknown> {
  const imageData = str(args.imageData);
  if (!imageData) return invalidArgs(kind);
  if (kind === "uploadCharacterImage") {
    const parsed = keyArgs(args);
    if (!parsed) return invalidArgs(kind);
    const result = await uploadCharacterImageOp(parsed.filePath, parsed.key, imageData);
    return result.ok ? result : fromOpFailure(result);
  }
  const parsed = beatArgs(args);
  if (!parsed) return invalidArgs(kind);
  const result = await uploadBeatImageOp(parsed.filePath, parsed.beatIndex, imageData);
  return result.ok ? result : fromOpFailure(result);
}

const PROBE_KINDS = new Set(["beatImage", "beatAudio", "beatMovie", "characterImage", "movieStatus", "pdfStatus"]);
const GENERATE_KINDS = new Set(["renderBeat", "generateBeatAudio", "renderCharacter", "generateMovie", "generatePdf"]);
const UPLOAD_KINDS = new Set(["uploadBeatImage", "uploadCharacterImage"]);

registerBuiltinDispatch(MULMOSCRIPT_SCOPE, async (args) => {
  const kind = str(args.kind);
  if (!kind) return invalidArgs("<missing>");
  if (kind === "save") return saveKind(args);
  if (kind === "updateBeat" || kind === "updateScript") return updateKind(kind, args);
  if (PROBE_KINDS.has(kind)) return probeKind(kind, args);
  if (GENERATE_KINDS.has(kind)) return generateKind(kind, args);
  if (UPLOAD_KINDS.has(kind)) return uploadKind(kind, args);
  if (kind === "pendingGenerations") {
    const filePath = str(args.filePath);
    if (!filePath) return invalidArgs(kind);
    return { ok: true, pending: pendingMulmoGenerations(filePath) };
  }
  return { ok: false, code: "bad_request", error: `unknown mulmoScript dispatch kind "${kind}"` };
});
