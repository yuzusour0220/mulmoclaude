// Transport-free cores for every mulmoScript operation. Extracted from
// `mulmo-script.ts` (phase 2 of plans/feat-mulmoscript-plugin.md) so the
// SAME implementation backs both surfaces:
//
//   - the legacy REST routes in `mulmo-script.ts` (kept for wire compat),
//   - the generic plugin dispatch in `server/plugins/mulmoscript-builtin.ts`
//     that the extracted @mulmoclaude/mulmoscript-plugin View calls.
//
// Every op returns an `OpResult` — failures are data (`code` preserves the
// HTTP mapping for the REST adapter) and never exceptions, mirroring the
// package's phase-1 outcome pattern. Generation ops publish start/finish
// through `publishMulmoGeneration`, which fans out to the session
// `pendingGenerations` channel AND the plugin pubsub channel the package
// View subscribes to.

import { existsSync, mkdirSync, realpathSync, readFileSync, statSync, unlinkSync, writeFileSync } from "fs";
import path from "path";
import { WORKSPACE_PATHS } from "../../workspace/paths.js";
import { writeFileAtomic } from "../../utils/files/atomic.js";
import { stripDataUri } from "../../utils/files/image-store.js";
import {
  getFileObject,
  initializeContextFromFiles,
  generateBeatImage,
  getBeatPngImagePath,
  generateBeatAudio,
  getBeatAudioPathOrUrl,
  getBeatAnimatedVideoPath,
  getBeatMoviePaths,
  generateReferenceImage,
  getReferenceImagePath,
  images,
  audio,
  movie,
  movieFilePath,
  pdf,
  pdfFilePath,
  setGraphAILogger,
  addSessionProgressCallback,
  removeSessionProgressCallback,
} from "mulmocast";
import type { MulmoBeat, MulmoImagePromptMedia } from "@mulmocast/types";
import { resolveWithinRoot } from "../../utils/files/safe.js";
import { errorMessage } from "../../utils/errors.js";
import { depStatus } from "../../system/optionalDeps.js";
import { log } from "../../system/logger/index.js";
import { enableGraphAIErrorCapture, withMulmoErrorCapture } from "../../utils/mulmoErrorCapture.js";
import { publishMulmoGeneration } from "../../events/mulmoscript-generation.js";
import { GENERATION_KINDS } from "../../../src/types/events.js";

// We pin pdfMode="slide" + pdfSize="a4" — that's the configured default
// for MulmoClaude's editor; mulmocast's other modes (talk / handout /
// letter) stay reachable via the CLI for power users. (#1614)
export const PDF_MODE = "slide" as const;
export const PDF_SIZE = "a4" as const;

// ── Result envelope ─────────────────────────────────────────────

export interface OpFailure {
  ok: false;
  /** REST adapter mapping: bad_request→400, not_found→404,
   *  unavailable→503, server_error→500. */
  code: "bad_request" | "not_found" | "server_error" | "unavailable";
  error: string;
}

export type OpResult<T> = ({ ok: true } & T) | OpFailure;

function opBadRequest(error: string): OpFailure {
  return { ok: false, code: "bad_request", error };
}

function opNotFound(error: string): OpFailure {
  return { ok: false, code: "not_found", error };
}

function opServerError(error: string): OpFailure {
  return { ok: false, code: "server_error", error };
}

// ── Story path / context infrastructure ─────────────────────────

const storiesDir = path.resolve(WORKSPACE_PATHS.stories);

// The download / status ops expect "stories/<rel>" (historical
// convention, independent of the on-disk location). After #284 the
// physical directory moved under artifacts/, so we can't return
// path.relative(workspacePath, ...) any more — that now begins with
// "artifacts/stories/". Re-rooting the path at storiesDir keeps the
// wire format stable.
export function toStoryRef(absolutePath: string): string {
  const rel = path.relative(storiesDir, absolutePath).split(path.sep).join("/");
  return rel ? `stories/${rel}` : "stories";
}

// Lazily realpath the stories dir on first use. We can't realpath at
// module load because the directory may not exist yet (it's created
// on demand by the save route). The cache is invalidated never —
// once the dir exists, its realpath is stable.
let storiesRealCache: string | null = null;
function ensureStoriesReal(): string | null {
  if (storiesRealCache) return storiesRealCache;
  try {
    mkdirSync(storiesDir, { recursive: true });
    storiesRealCache = realpathSync(storiesDir);
    return storiesRealCache;
  } catch {
    return null;
  }
}

/**
 * Resolve and validate a stories wire path to its absolute realpath.
 *
 * Uses the realpath-based resolveWithinRoot helper to defeat
 * symlink-based escapes. Callers pass workspace-relative paths like
 * "stories/foo.json" or "stories/__movies__/bar.mp4". We strip the
 * leading "stories/" segment and resolve the remainder against the
 * realpath of the stories directory itself — this works whether
 * stories/ is a regular directory or a legitimate symlink to another
 * location. ENOENT and traversal are distinguished (404 vs 400).
 */
export function resolveStory(filePath: string): { ok: true; absolutePath: string } | OpFailure {
  const storiesReal = ensureStoriesReal();
  if (!storiesReal) {
    return opServerError("stories directory not available");
  }
  // Reject absolute paths and parent traversal at the syntactic
  // level — defense in depth on top of the realpath check below.
  if (path.isAbsolute(filePath)) {
    return opBadRequest("Invalid filePath");
  }
  // Strip the optional "stories/" prefix so the remainder is a path
  // relative to storiesReal. Accepts both "stories/foo.json" (the
  // canonical caller convention) and bare "foo.json".
  const STORIES_PREFIX = `stories${path.sep}`;
  const relFromStories =
    filePath === "stories" ? "" : filePath.startsWith(STORIES_PREFIX) || filePath.startsWith("stories/") ? filePath.slice("stories/".length) : filePath;
  // resolveWithinRoot enforces both the realpath boundary AND
  // existence; ENOENT and traversal both produce null. Distinguish
  // them via a follow-up existsSync so 404 vs 400 stays accurate.
  const resolved = resolveWithinRoot(storiesReal, relFromStories);
  if (!resolved) {
    const candidate = path.resolve(storiesReal, relFromStories);
    if (!existsSync(candidate)) {
      return opNotFound(`File not found: ${filePath}`);
    }
    return opBadRequest("Invalid filePath");
  }
  return { ok: true, absolutePath: resolved };
}

// mulmocast shells out to ffmpeg for movie / beat rendering. When
// ffmpeg is absent the optional-deps probe (#1385) marks it
// unavailable; intercept here with a clear failure instead of letting
// the library throw an opaque spawn ENOENT mid-pipeline. `undefined`
// means the boot probe hasn't completed — assume available so a
// brief startup window never blocks a render.
export function ffmpegGuard(): OpFailure | null {
  if (depStatus("ffmpeg")?.available === false) {
    return {
      ok: false,
      code: "unavailable",
      error: "ffmpeg is not installed — movie and beat rendering are unavailable. Install ffmpeg and restart the server.",
    };
  }
  return null;
}

// Helper: build mulmo context for a story file
export async function buildContext(absoluteFilePath: string, force = false) {
  // setGraphAILogger(false) silences GraphAI's chatty info/debug output
  // but also its error level — re-enable error capture so a failed
  // generation surfaces the real provider error, not just mulmocast's
  // generic "generate error" wrapper.
  setGraphAILogger(false);
  enableGraphAIErrorCapture();
  const files = getFileObject({
    file: absoluteFilePath,
    basedir: path.dirname(absoluteFilePath),
    grouped: true,
  });
  return initializeContextFromFiles(files, true, force);
}

// Awaited context type used by every op that calls buildContext.
export type StoryContext = NonNullable<Awaited<ReturnType<typeof buildContext>>>;

export interface RunStoryOpDeps {
  resolveStory?: typeof resolveStory;
  buildContext?: (absoluteFilePath: string, force?: boolean) => Promise<StoryContext | undefined>;
}

export interface RunStoryOpOptions<T> {
  force?: boolean;
  /**
   * Op-specific tag included in the failure log so dashboards can
   * distinguish which op is failing (e.g. `"generate-beat-audio"`).
   * Falls back to a generic `"op failed"` entry when omitted.
   */
  operation?: string;
  /**
   * Soft-fail override for `buildContext` returning undefined. Some
   * ops (e.g. `beatAudio`) historically returned a 200 `{ audio: null }`
   * in that case so the frontend can silently retry. If provided, this
   * callback returns the fallback result instead of the default
   * server_error "Failed to initialize mulmo context".
   */
  onContextMissing?: () => OpResult<T>;
}

/**
 * Shared scaffolding for mulmoScript ops. Resolves the wire filePath,
 * builds the mulmo context, and folds unexpected handler errors into a
 * server_error failure (with a warn breadcrumb). Successor of the
 * res-coupled `withStoryContext`; accepts a `deps` param so unit tests
 * can inject fakes without the full mulmocast stack.
 */
export async function runStoryOp<T>(
  filePath: string,
  options: RunStoryOpOptions<T>,
  handler: (ctx: { absoluteFilePath: string; context: StoryContext }) => Promise<OpResult<T>>,
  deps: RunStoryOpDeps = {},
): Promise<OpResult<T>> {
  const resolver = deps.resolveStory ?? resolveStory;
  const build = deps.buildContext ?? buildContext;
  const resolved = resolver(filePath);
  if (!resolved.ok) return resolved;
  try {
    const context = await build(resolved.absolutePath, options.force ?? false);
    if (!context) {
      if (options.onContextMissing) return options.onContextMissing();
      return opServerError("Failed to initialize mulmo context");
    }
    // withMulmoErrorCapture appends the underlying provider error
    // (missing API key, quota, …) to any mulmocast failure, which
    // otherwise reaches the client as a generic "generate error".
    return await withMulmoErrorCapture(() => handler({ absoluteFilePath: resolved.absolutePath, context }));
  } catch (err) {
    // Log every op failure at warn so operators get a breadcrumb even
    // when the op doesn't wrap its own try/catch. Consistent with the
    // chat-index / wiki-backlinks / journal fire-and-forget pattern.
    log.warn("mulmo-script", "op failed", {
      ...(options.operation ? { operation: options.operation } : {}),
      filePath,
      error: errorMessage(err),
    });
    return opServerError(errorMessage(err));
  }
}

export function fileToDataUri(filePath: string, mimeType: string): string {
  const data = readFileSync(filePath);
  return `data:${mimeType};base64,${data.toString("base64")}`;
}

// ── Probe ops ───────────────────────────────────────────────────

export async function beatImageOp(filePath: string, beatIndex: number): Promise<OpResult<{ image: string | null }>> {
  return runStoryOp<{ image: string | null }>(filePath, { operation: "beat-image" }, async ({ context }) => {
    const { imagePath } = getBeatPngImagePath(context, beatIndex);
    if (!existsSync(imagePath)) return { ok: true, image: null };
    return { ok: true, image: fileToDataUri(imagePath, "image/png") };
  });
}

// beatAudio is a probe — the frontend polls it expecting `{ audio: null }`
// when nothing has been generated yet. Override the default
// server_error-on-context-missing so the soft-fail contract is preserved.
export async function beatAudioOp(filePath: string, beatIndex: number): Promise<OpResult<{ audio: string | null }>> {
  return runStoryOp<{ audio: string | null }>(
    filePath,
    { operation: "beat-audio", onContextMissing: () => ({ ok: true, audio: null }) },
    async ({ context }) => {
      const beat = context.studio.script.beats[beatIndex];
      const audioPath = getBeatAudioPathOrUrl(beat.text ?? "", context, beat, context.lang);
      if (!audioPath || !existsSync(audioPath)) return { ok: true, audio: null };
      return { ok: true, audio: fileToDataUri(audioPath, "audio/mpeg") };
    },
  );
}

// Probe for a beat's generated video clip. Preference order mirrors the
// movie-assembly pipeline's "most processed wins": lip-synced > with
// sound effect > raw movie clip > animated html_tailwind render. The
// response is the "stories/…" wire path so the client can stream it
// through the host's authenticated media download.
export async function beatMovieOp(filePath: string, beatIndex: number): Promise<OpResult<{ moviePath: string | null }>> {
  return runStoryOp<{ moviePath: string | null }>(filePath, { operation: "beat-movie" }, async ({ context }) => {
    const { movieFile, soundEffectFile, lipSyncFile } = getBeatMoviePaths(context, beatIndex);
    const candidates = [lipSyncFile, soundEffectFile, movieFile, getBeatAnimatedVideoPath(context, beatIndex)];
    const existing = candidates.find((candidate) => existsSync(candidate));
    return { ok: true, moviePath: existing ? toStoryRef(existing) : null };
  });
}

export async function characterImageOp(filePath: string, key: string): Promise<OpResult<{ image: string | null }>> {
  return runStoryOp<{ image: string | null }>(filePath, { operation: "character-image" }, async ({ context }) => {
    const imagePath = getReferenceImagePath(context, key, "png");
    if (!existsSync(imagePath)) return { ok: true, image: null };
    return { ok: true, image: fileToDataUri(imagePath, "image/png") };
  });
}

/** Shared "output exists and is newer than the source script" gate for
 *  movie / PDF status. A stale artifact (script edited after it was
 *  generated) reports null so the UI re-offers the Generate button. */
function freshOutputRef(outputPath: string, absoluteFilePath: string): string | null {
  if (!existsSync(outputPath)) return null;
  const outputMtime = statSync(outputPath).mtimeMs;
  const sourceMtime = statSync(absoluteFilePath).mtimeMs;
  if (outputMtime < sourceMtime) return null;
  return toStoryRef(outputPath);
}

export async function movieStatusOp(filePath: string): Promise<OpResult<{ moviePath: string | null }>> {
  return runStoryOp(
    filePath,
    { operation: "movie-status", onContextMissing: () => ({ ok: true, moviePath: null }) },
    async ({ absoluteFilePath, context }) => ({ ok: true, moviePath: freshOutputRef(movieFilePath(context), absoluteFilePath) }),
  );
}

export async function pdfStatusOp(filePath: string): Promise<OpResult<{ pdfPath: string | null }>> {
  return runStoryOp(filePath, { operation: "pdf-status", onContextMissing: () => ({ ok: true, pdfPath: null }) }, async ({ absoluteFilePath, context }) => ({
    ok: true,
    pdfPath: freshOutputRef(pdfFilePath(context, PDF_MODE), absoluteFilePath),
  }));
}

// ── Generation ops ──────────────────────────────────────────────

export interface GenerateOpArgs {
  filePath: string;
  beatIndex?: number;
  key?: string;
  force?: boolean;
  chatSessionId?: string;
}

export async function renderBeatOp(args: Required<Pick<GenerateOpArgs, "filePath" | "beatIndex">> & GenerateOpArgs): Promise<OpResult<{ image: string }>> {
  const { filePath, beatIndex, force, chatSessionId } = args;
  const ffmpeg = ffmpegGuard();
  if (ffmpeg) return ffmpeg;

  const mapKey = String(beatIndex);
  publishMulmoGeneration(chatSessionId, GENERATION_KINDS.beatImage, filePath, mapKey, false);
  let genError: string | undefined;
  try {
    const result = await runStoryOp<{ image: string }>(filePath, { force, operation: "render-beat" }, async ({ context }) => {
      await generateBeatImage({
        index: beatIndex,
        context,
        args: force ? { forceImage: true } : undefined,
      });
      const { imagePath } = getBeatPngImagePath(context, beatIndex);
      if (!existsSync(imagePath)) {
        return opServerError("Image was not generated");
      }
      return { ok: true, image: fileToDataUri(imagePath, "image/png") };
    });
    if (!result.ok) genError = result.error;
    return result;
  } finally {
    publishMulmoGeneration(chatSessionId, GENERATION_KINDS.beatImage, filePath, mapKey, true, genError);
  }
}

export async function generateBeatAudioOp(
  args: Required<Pick<GenerateOpArgs, "filePath" | "beatIndex">> & GenerateOpArgs,
): Promise<OpResult<{ audio: string }>> {
  const { filePath, beatIndex, force, chatSessionId } = args;
  const mapKey = String(beatIndex);
  publishMulmoGeneration(chatSessionId, GENERATION_KINDS.beatAudio, filePath, mapKey, false);
  let genError: string | undefined;
  try {
    const result = await runStoryOp<{ audio: string }>(filePath, { force, operation: "generate-beat-audio" }, async ({ context }) => {
      await generateBeatAudio(beatIndex, context, {
        settings: process.env as Record<string, string>,
      } as Parameters<typeof generateBeatAudio>[2]);

      const beat = context.studio.script.beats[beatIndex];
      const audioPath = context.studio.beats[beatIndex]?.audioFile ?? getBeatAudioPathOrUrl(beat.text ?? "", context, beat, context.lang);

      if (!audioPath || !existsSync(audioPath)) {
        // Logic-flow failure (not an exception) — emit a targeted
        // log. Don't write raw `beat.text` into persistent logs —
        // it's free-form user content and can contain sensitive
        // data.
        log.error("generate-beat-audio", "audio was not generated", {
          beatIndex,
          audioPath,
          exists: audioPath ? existsSync(audioPath) : false,
          beatTextLength: typeof beat?.text === "string" ? beat.text.length : 0,
          audioFilePresent: Boolean(context.studio.beats[beatIndex]?.audioFile),
        });
        return opServerError("Audio was not generated");
      }
      return { ok: true, audio: fileToDataUri(audioPath, "audio/mpeg") };
    });
    if (!result.ok) genError = result.error;
    return result;
  } finally {
    publishMulmoGeneration(chatSessionId, GENERATION_KINDS.beatAudio, filePath, mapKey, true, genError);
  }
}

export async function renderCharacterOp(args: Required<Pick<GenerateOpArgs, "filePath" | "key">> & GenerateOpArgs): Promise<OpResult<{ image: string }>> {
  const { filePath, key, force, chatSessionId } = args;
  publishMulmoGeneration(chatSessionId, GENERATION_KINDS.characterImage, filePath, key, false);
  let genError: string | undefined;
  try {
    const result = await runStoryOp<{ image: string }>(filePath, { force, operation: "render-character" }, async ({ context }) => {
      // `imageEntries` (not `images`) to avoid shadowing mulmocast's
      // imported `images()` pipeline stage.
      const imageEntries = context.studio.script.imageParams?.images ?? {};
      const imageEntry = imageEntries[key];
      if (!imageEntry || imageEntry.type !== "imagePrompt") {
        return opBadRequest(`No imagePrompt entry for key: ${key}`);
      }

      const index = Object.keys(imageEntries).indexOf(key);
      const imagePath = getReferenceImagePath(context, key, "png");
      mkdirSync(path.dirname(imagePath), { recursive: true });

      await generateReferenceImage({
        context,
        key,
        index,
        image: imageEntry as MulmoImagePromptMedia,
        force,
      });
      if (!existsSync(imagePath)) {
        return opServerError("Character image was not generated");
      }
      return { ok: true, image: fileToDataUri(imagePath, "image/png") };
    });
    if (!result.ok) genError = result.error;
    return result;
  } finally {
    publishMulmoGeneration(chatSessionId, GENERATION_KINDS.characterImage, filePath, key, true, genError);
  }
}

// ── Upload ops ──────────────────────────────────────────────────

export async function uploadBeatImageOp(filePath: string, beatIndex: number, imageData: string): Promise<OpResult<{ image: string }>> {
  return runStoryOp<{ image: string }>(filePath, { operation: "upload-beat-image" }, async ({ context }) => {
    const { imagePath } = getBeatPngImagePath(context, beatIndex);
    // writeFileAtomic creates parent dirs and prevents a half-
    // written PNG from surviving a crash mid-write (#881 v2).
    const base64 = stripDataUri(imageData);
    await writeFileAtomic(imagePath, Buffer.from(base64, "base64"));
    return { ok: true, image: fileToDataUri(imagePath, "image/png") };
  });
}

export async function uploadCharacterImageOp(filePath: string, key: string, imageData: string): Promise<OpResult<{ image: string }>> {
  return runStoryOp<{ image: string }>(filePath, { operation: "upload-character-image" }, async ({ context }) => {
    const imagePath = getReferenceImagePath(context, key, "png");
    const base64 = stripDataUri(imageData);
    await writeFileAtomic(imagePath, Buffer.from(base64, "base64"));
    return { ok: true, image: fileToDataUri(imagePath, "image/png") };
  });
}

// ── Movie / PDF pipelines ───────────────────────────────────────

// Module-level dedup so a foreground call (SSE route or long-held
// dispatch) and a fire-and-forget background call can't race on the same
// script. Keyed by the realpath (absoluteFilePath) so two different wire
// spellings of the same file still collide. The set is intentionally
// process-local — a multi-process deployment would need an external
// lock; that's out of scope.
export const inFlightMovies = new Set<string>();

// Same dedup model as inFlightMovies, scoped to PDF generation
// (#1614). PDFs and movies don't share the lock — they write to
// different output files and can safely run in parallel.
export const inFlightPdfs = new Set<string>();

export type MovieGenerationResult = { ok: true; outputPath: string } | { ok: false; error: string };

export interface MovieProgressEvent {
  kind: "image" | "audio";
  beatIndex: number;
}

// Map each beat to its array index, keyed by beat.id (falling back to
// a synthetic `__index__<n>` for id-less beats). Shared by the movie
// and PDF pipelines to translate mulmocast's per-beat progress events
// (which carry the beat id) back into an index the UI can address.
export function buildBeatIdIndex(beats: MulmoBeat[]): Map<string, number> {
  const idToIndex = new Map<string, number>();
  beats.forEach((beat, index) => {
    const key = beat.id ?? `__index__${index}`;
    idToIndex.set(key, index);
  });
  return idToIndex;
}

// Shared core for the SSE-streaming route, the long-held dispatch op, and
// the fire-and-forget background path triggered by `autoGenerateMovie`.
// Builds the mulmo context, runs audio→images→movie, and reports
// per-beat progress through the supplied callback. Throws on
// unexpected pipeline errors; returns a structured failure when the
// pipeline runs to completion but the output file is missing.
export async function runMovieGeneration(absoluteFilePath: string, onProgressEvent: (event: MovieProgressEvent) => void): Promise<MovieGenerationResult> {
  return withMulmoErrorCapture(() => runMoviePipeline(absoluteFilePath, onProgressEvent));
}

async function runMoviePipeline(absoluteFilePath: string, onProgressEvent: (event: MovieProgressEvent) => void): Promise<MovieGenerationResult> {
  const context = await buildContext(absoluteFilePath);
  if (!context) return { ok: false, error: "Failed to initialize mulmo context" };

  const idToIndex = buildBeatIdIndex(context.studio.script.beats as MulmoBeat[]);

  // Known limitation: addSessionProgressCallback is global, so when two
  // movie generations for *different* scripts run concurrently, both
  // closures are invoked for every beat event and rely on idToIndex to
  // filter out the other run's events. That filter is reliable only
  // when each beat carries an explicit `id`. Beats without one fall
  // back to "__index__${index}", and identical fallback ids across
  // scripts collide → progress meant for script A surfaces on script B.
  // Fixing this properly needs mulmocast to attach a per-run identifier
  // to its progress events (or a global serialization gate); tracked
  // separately, out of scope for this PR.
  const onProgress = (event: { kind: string; sessionType: string; id?: string; inSession: boolean }) => {
    if (event.kind !== "beat" || event.inSession || event.id === undefined) return;
    const beatIndex = idToIndex.get(event.id);
    if (beatIndex === undefined) return;
    if (event.sessionType !== "image" && event.sessionType !== "audio") return;
    onProgressEvent({ kind: event.sessionType, beatIndex });
  };

  addSessionProgressCallback(onProgress);
  try {
    // Order matters: audio() must run before images(). For html_tailwind
    // beats with `animation: true`, mulmocast only emits the per-beat
    // `_animated.mp4` when the beat's duration is already known (see
    // processHtmlTailwindAnimated in mulmocast). Durations are populated
    // by audio(), so running images() first leaves the .mp4 files
    // missing and movie() then fails in validateBeatSource.
    const audioContext = await audio(context);
    const imagesContext = await images(audioContext);
    await movie(imagesContext);

    const outputPath = movieFilePath(imagesContext);
    if (!existsSync(outputPath)) return { ok: false, error: "Movie was not generated" };
    return { ok: true, outputPath };
  } finally {
    removeSessionProgressCallback(onProgress);
  }
}

/**
 * Long-held foreground movie generation (the package View's
 * `generateMovie` dispatch). Resolves when the whole pipeline finishes.
 * Per-beat completions are mirrored to the generation channels so the
 * initiating View (and any other mounted View) reloads assets off disk
 * as they land — the successor of the SSE per-beat events.
 */
export async function generateMovieOp(filePath: string, chatSessionId: string | undefined): Promise<OpResult<{ moviePath: string }>> {
  const ffmpeg = ffmpegGuard();
  if (ffmpeg) return ffmpeg;
  const resolved = resolveStory(filePath);
  if (!resolved.ok) return resolved;
  const absoluteFilePath = resolved.absolutePath;

  if (inFlightMovies.has(absoluteFilePath)) {
    return opBadRequest("Movie generation is already in progress for this script");
  }

  inFlightMovies.add(absoluteFilePath);
  publishMulmoGeneration(chatSessionId, GENERATION_KINDS.movie, filePath, "", false);
  let genError: string | undefined;
  try {
    const result = await runMovieGeneration(absoluteFilePath, (event) => {
      const eventKind = event.kind === "image" ? GENERATION_KINDS.beatImage : GENERATION_KINDS.beatAudio;
      publishMulmoGeneration(chatSessionId, eventKind, filePath, String(event.beatIndex), true);
    });
    if (!result.ok) {
      genError = result.error;
      return opServerError(result.error);
    }
    return { ok: true, moviePath: toStoryRef(result.outputPath) };
  } catch (err) {
    genError = errorMessage(err);
    return opServerError(genError);
  } finally {
    inFlightMovies.delete(absoluteFilePath);
    publishMulmoGeneration(chatSessionId, GENERATION_KINDS.movie, filePath, "", true, genError);
  }
}

export function triggerAutoBackgroundMovie(absoluteFilePath: string, wireFilePath: string, chatSessionId: string | undefined): void {
  if (inFlightMovies.has(absoluteFilePath)) return;
  inFlightMovies.add(absoluteFilePath);
  void runBackgroundMovieGeneration(absoluteFilePath, wireFilePath, chatSessionId);
}

// Detached movie generation. Reports progress through the generation
// channels the View watches — so a user opening the canvas
// mid-generation sees spinners, and a user opening it after completion
// sees the finished movie loaded from disk by the View's normal
// mount-time path. Errors are persisted to a `<filename>.error.txt`
// sidecar next to the script (no synchronous client to alert); any
// stale sidecar from a previous run is cleared on each new attempt.
// Triggered server-side from the unified save route when the caller
// passes `autoGenerateMovie: true`.
async function runBackgroundMovieGeneration(absoluteFilePath: string, wireFilePath: string, chatSessionId: string | undefined): Promise<void> {
  const errorSidecarPath = `${absoluteFilePath}.error.txt`;
  // Clear stale error from a previous failed run before starting; if it
  // doesn't exist that's fine. Catch any unexpected fs errors silently —
  // the worst case is the user sees an out-of-date error file later.
  try {
    unlinkSync(errorSidecarPath);
  } catch {
    // intentional: ENOENT is the common case, others non-fatal
  }

  publishMulmoGeneration(chatSessionId, GENERATION_KINDS.movie, wireFilePath, "", false);
  let genError: string | undefined;
  try {
    const result = await runMovieGeneration(absoluteFilePath, (event) => {
      // Mirror per-beat completions through the generation channels so
      // subscribed Views reload the asset off disk. We fire start+finish
      // in two ticks — `setImmediate` lets the session SSE writer flush
      // the start event before the finish removes the entry, otherwise
      // Vue's batched reactivity could see a net "no change" and skip
      // the reload.
      const eventKind = event.kind === "image" ? GENERATION_KINDS.beatImage : GENERATION_KINDS.beatAudio;
      const key = String(event.beatIndex);
      publishMulmoGeneration(chatSessionId, eventKind, wireFilePath, key, false);
      setImmediate(() => publishMulmoGeneration(chatSessionId, eventKind, wireFilePath, key, true));
    });

    if (!result.ok) {
      genError = result.error;
      writeErrorSidecar(errorSidecarPath, result.error);
      log.warn("mulmo-script", "background movie generation failed", { filePath: wireFilePath, error: result.error });
      return;
    }
    log.info("mulmo-script", "background movie generation done", {
      filePath: wireFilePath,
      outputPath: result.outputPath,
    });
  } catch (err) {
    genError = errorMessage(err);
    writeErrorSidecar(errorSidecarPath, genError);
    log.error("mulmo-script", "background movie generation crashed", { filePath: wireFilePath, error: genError });
  } finally {
    inFlightMovies.delete(absoluteFilePath);
    publishMulmoGeneration(chatSessionId, GENERATION_KINDS.movie, wireFilePath, "", true, genError);
  }
}

function writeErrorSidecar(errorSidecarPath: string, message: string): void {
  try {
    writeFileSync(errorSidecarPath, message);
  } catch (writeErr) {
    log.error("mulmo-script", "failed to write error sidecar", {
      errorSidecarPath,
      error: errorMessage(writeErr),
    });
  }
}

// ── PDF (#1614) ─────────────────────────────────────────────────
//
// PDF is the third output channel for a MulmoScript, alongside the
// existing movie pipeline. (The PDF_MODE / PDF_SIZE pins live near the
// top of this module because pdfStatusOp reads PDF_MODE too.)

export type PdfGenerationResult = { ok: true; outputPath: string } | { ok: false; error: string };

// Shared core for the SSE-streaming route and the long-held dispatch op.
// Mirrors the movie pipeline's per-beat progress reporting so the UI can
// light spinners during the image pass; the PDF action itself doesn't
// emit progress events, so only image events are forwarded. Returns a
// structured failure when the pipeline completes but the output file is
// missing.
export async function runPdfGeneration(context: StoryContext, onImageBeatDone: (beatIndex: number) => void): Promise<PdfGenerationResult> {
  return withMulmoErrorCapture(() => runPdfPipeline(context, onImageBeatDone));
}

async function runPdfPipeline(context: StoryContext, onImageBeatDone: (beatIndex: number) => void): Promise<PdfGenerationResult> {
  const idToIndex = buildBeatIdIndex(context.studio.script.beats as MulmoBeat[]);
  const onProgress = (event: { kind: string; sessionType: string; id?: string; inSession: boolean }) => {
    if (event.kind !== "beat" || event.inSession || event.id === undefined) return;
    const beatIndex = idToIndex.get(event.id);
    if (beatIndex === undefined) return;
    if (event.sessionType !== "image") return;
    onImageBeatDone(beatIndex);
  };
  addSessionProgressCallback(onProgress);
  try {
    const imagesContext = await images(context);
    await pdf(imagesContext, PDF_MODE, PDF_SIZE);
    const outputPath = pdfFilePath(imagesContext, PDF_MODE);
    if (!existsSync(outputPath)) return { ok: false, error: "PDF was not generated" };
    return { ok: true, outputPath };
  } finally {
    removeSessionProgressCallback(onProgress);
  }
}

/** Long-held foreground PDF generation (the package View's `generatePdf`
 *  dispatch) — the PDF sibling of `generateMovieOp`. */
export async function generatePdfOp(filePath: string, chatSessionId: string | undefined): Promise<OpResult<{ pdfPath: string }>> {
  const ffmpeg = ffmpegGuard();
  if (ffmpeg) return ffmpeg;
  const resolved = resolveStory(filePath);
  if (!resolved.ok) return resolved;
  const absoluteFilePath = resolved.absolutePath;

  if (inFlightPdfs.has(absoluteFilePath)) {
    return opBadRequest("PDF generation is already in progress for this script");
  }

  inFlightPdfs.add(absoluteFilePath);
  publishMulmoGeneration(chatSessionId, GENERATION_KINDS.pdf, filePath, "", false);
  let genError: string | undefined;
  try {
    const context = await buildContext(absoluteFilePath);
    if (!context) {
      genError = "Failed to initialize mulmo context";
      return opServerError(genError);
    }
    const result = await runPdfGeneration(context, (beatIndex) => {
      publishMulmoGeneration(chatSessionId, GENERATION_KINDS.beatImage, filePath, String(beatIndex), true);
    });
    if (!result.ok) {
      genError = result.error;
      return opServerError(result.error);
    }
    return { ok: true, pdfPath: toStoryRef(result.outputPath) };
  } catch (err) {
    genError = errorMessage(err);
    return opServerError(genError);
  } finally {
    inFlightPdfs.delete(absoluteFilePath);
    publishMulmoGeneration(chatSessionId, GENERATION_KINDS.pdf, filePath, "", true, genError);
  }
}
