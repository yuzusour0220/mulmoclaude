// Public API for local voice input (whisper.cpp). Combines the model
// registry/downloader (models.ts), the warm sidecar (sidecar.ts), and
// the ffmpeg conversion step into the surface the transcribe route and
// the /api/health endpoint consume. See plans/feat-voice-input.md.

import { mkdirSync } from "fs";
import { rm, writeFile } from "fs/promises";
import path from "path";
import { WORKSPACE_PATHS } from "../../workspace/paths.js";
import { shortId } from "../../utils/id.js";
import { convertToWav16k } from "../../utils/audio/ffmpeg.js";
import { depStatus } from "../optionalDeps.js";
import type { AppSettings } from "../config.js";
import { transcribeWav, warmupSidecar } from "./sidecar.js";
import { ensureModelDownloaded, getModelStatus, isModelReady, resolveModelName, type ModelStatus, type WhisperModelName } from "./models.js";

export { stopWhisperSidecar } from "./sidecar.js";
export { WHISPER_MODELS, DEFAULT_WHISPER_MODEL, isWhisperModelName, type WhisperModelName } from "./models.js";

// Scratch dir for transient audio — a hidden subdir of the models dir
// so it shares the (non-git) models tree rather than landing in
// os.tmpdir(). Files are deleted immediately after each transcription.
const SCRATCH_DIR = path.join(WORKSPACE_PATHS.models, ".scratch");

/** Whisper.cpp local transcription needs macOS (Metal) + the
 *  whisper-server binary on PATH. `depStatus` returns undefined until
 *  the boot probe completes — treat that as not-yet-capable so the mic
 *  button doesn't flicker on before we know. */
export function isVoiceInputCapable(): boolean {
  return process.platform === "darwin" && depStatus("whisper")?.available === true;
}

export interface VoiceInputStatus {
  /** Platform + binary present: the Settings enable toggle is offerable. */
  capable: boolean;
  /** User opted in via Settings. */
  enabled: boolean;
  /** Selected model + its download/readiness state. */
  model: { name: WhisperModelName } & ModelStatus;
}

export function selectedModel(settings: AppSettings): WhisperModelName {
  return resolveModelName(settings.voiceInput?.model);
}

export function getVoiceInputStatus(settings: AppSettings): VoiceInputStatus {
  const name = selectedModel(settings);
  return {
    capable: isVoiceInputCapable(),
    enabled: settings.voiceInput?.enabled === true,
    model: { name, ...getModelStatus(name) },
  };
}

/** The mic button gates on all three: capable + enabled + model ready. */
export function isVoiceInputReady(settings: AppSettings): boolean {
  return isVoiceInputCapable() && settings.voiceInput?.enabled === true && isModelReady(selectedModel(settings));
}

/** Start downloading the selected model (fire-and-forget; idempotent).
 *  Once the download completes and the feature is enabled, pre-warm the
 *  sidecar so the user's first transcription after enabling is fast. */
export function startModelDownload(settings: AppSettings): WhisperModelName {
  const name = selectedModel(settings);
  ensureModelDownloaded(name)
    .then(() => warmupVoiceInput(settings))
    .catch(() => undefined);
  return name;
}

/** Pre-spawn the sidecar at boot when voice input is already enabled +
 *  ready, so the first transcription of the session doesn't pay the
 *  model-load cost inside the request. No-op otherwise. */
export function warmupVoiceInput(settings: AppSettings): void {
  if (!isVoiceInputReady(settings)) return;
  warmupSidecar(selectedModel(settings)).catch(() => undefined);
}

// whisper.cpp returns these sentinels for non-speech windows; treat
// them as an empty transcript so the UI shows "didn't catch that"
// rather than inserting a literal marker.
const BLANK_MARKERS = new Set(["[blank_audio]", "[silence]", "(silence)", "[ inaudible ]"]);

function normalizeTranscript(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  return BLANK_MARKERS.has(trimmed.toLowerCase()) ? "" : trimmed;
}

export interface TranscribeRequest {
  base64: string;
  mimeType: string;
  language: string;
  model: WhisperModelName;
}

/** Decode → ffmpeg → whisper sidecar → normalized text. Temp files are
 *  always cleaned up, including on error. */
export async function transcribeAudio(req: TranscribeRequest): Promise<{ text: string }> {
  mkdirSync(SCRATCH_DIR, { recursive: true });
  const clipId = shortId();
  const inputPath = path.join(SCRATCH_DIR, `utterance-${clipId}.webm`);
  const wavPath = path.join(SCRATCH_DIR, `utterance-${clipId}.wav`);
  try {
    await writeFile(inputPath, Buffer.from(req.base64, "base64"));
    await convertToWav16k(inputPath, wavPath);
    const text = await transcribeWav(wavPath, req.language, req.model);
    return { text: normalizeTranscript(text) };
  } finally {
    await rm(inputPath, { force: true });
    await rm(wavPath, { force: true });
  }
}
