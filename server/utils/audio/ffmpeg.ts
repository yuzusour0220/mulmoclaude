// Thin wrapper around the system `ffmpeg` binary for audio format
// conversion. ffmpeg is an optional host dependency probed at boot
// (server/system/optionalDeps.ts, id "ffmpeg"); callers must gate on
// `depStatus("ffmpeg")` before invoking. Used by local voice input to
// turn a browser `webm/opus` clip into the 16 kHz mono 16-bit WAV
// whisper.cpp requires.

import { execFile } from "child_process";
import { promisify } from "util";
import { SUBPROCESS_WORK_TIMEOUT_MS } from "../time.js";

const execFileAsync = promisify(execFile);

/** ffmpeg args to decode any input to 16 kHz mono signed-16-bit WAV —
 *  whisper.cpp's required input format. Pure + exported for unit tests. */
export function buildWav16kArgs(inputPath: string, outputPath: string): string[] {
  return ["-y", "-loglevel", "error", "-i", inputPath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", outputPath];
}

/** Convert `inputPath` to a 16 kHz mono WAV at `outputPath`. Throws on
 *  ffmpeg failure or timeout. */
export async function convertToWav16k(inputPath: string, outputPath: string): Promise<void> {
  await execFileAsync("ffmpeg", buildWav16kArgs(inputPath, outputPath), {
    timeout: SUBPROCESS_WORK_TIMEOUT_MS,
  });
}
