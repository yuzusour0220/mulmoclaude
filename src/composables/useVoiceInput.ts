// Push-to-talk voice capture for the chat input. Records one utterance
// with MediaRecorder, ships it to the local /api/transcribe endpoint as
// a base64 data URL (same convention as attachments), and hands the
// transcript back to the caller for review-before-send. Mac-only — the
// mic button is hidden unless the backend reports voice input ready.
// See plans/feat-voice-input.md.

import { onScopeDispose, ref, type Ref } from "vue";
import { API_ROUTES } from "../config/apiRoutes";
import { apiGet, apiPost } from "../utils/api";

export interface VoiceModelStatus {
  name: string;
  state: "idle" | "downloading" | "ready" | "error";
  progress?: number;
  error?: string;
}

export interface VoiceInputStatusResponse {
  capable: boolean;
  enabled: boolean;
  model: VoiceModelStatus;
}

// Map a UI locale (vue-i18n) to a Whisper language code. UI language is
// a strong prior for the spoken language; "auto" lets Whisper detect it
// from the audio when there's no confident mapping.
const LOCALE_TO_WHISPER: Record<string, string> = {
  en: "en",
  ja: "ja",
  zh: "zh",
  ko: "ko",
  es: "es",
  "pt-BR": "pt",
  fr: "fr",
  de: "de",
};

export function localeToWhisperLanguage(locale: string): string {
  return LOCALE_TO_WHISPER[locale] ?? "auto";
}

function pickRecorderMime(): string | undefined {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  if (typeof MediaRecorder === "undefined") return undefined;
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

export interface UseVoiceInputOptions {
  /** Current vue-i18n locale (for default transcription language). */
  locale: () => string;
  /** Called with the transcript once recognized (never empty). */
  onTranscript: (text: string) => void;
  /** Called when recognition produced no speech. */
  onEmpty?: () => void;
}

export interface UseVoiceInput {
  available: Ref<boolean>;
  recording: Ref<boolean>;
  transcribing: Ref<boolean>;
  error: Ref<string | null>;
  refreshAvailability: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => void;
}

export function useVoiceInput(opts: UseVoiceInputOptions): UseVoiceInput {
  const available = ref(false);
  const recording = ref(false);
  const transcribing = ref(false);
  const error = ref<string | null>(null);

  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: Blob[] = [];

  async function refreshAvailability(): Promise<void> {
    const result = await apiGet<VoiceInputStatusResponse>(API_ROUTES.transcribe.model);
    available.value = result.ok && result.data.capable && result.data.enabled && result.data.model.state === "ready";
  }

  function releaseStream(): void {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    recorder = null;
  }

  async function transcribe(blob: Blob): Promise<void> {
    transcribing.value = true;
    try {
      const dataUrl = await blobToDataUrl(blob);
      const result = await apiPost<{ text: string }>(API_ROUTES.transcribe.run, {
        dataUrl,
        language: localeToWhisperLanguage(opts.locale()),
      });
      if (!result.ok) {
        error.value = result.error || "transcription failed";
        return;
      }
      const text = result.data.text.trim();
      if (text.length === 0) opts.onEmpty?.();
      else opts.onTranscript(text);
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
    } finally {
      transcribing.value = false;
    }
  }

  async function start(): Promise<void> {
    if (recording.value || transcribing.value) return;
    error.value = null;
    const mimeType = pickRecorderMime();
    if (!mimeType || !navigator.mediaDevices?.getUserMedia) {
      error.value = "unsupported";
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      error.value = "permission-denied";
      return;
    }
    chunks = [];
    recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      releaseStream();
      if (blob.size > 0) void transcribe(blob);
    };
    recorder.start();
    recording.value = true;
  }

  function stop(): void {
    if (!recording.value || !recorder) return;
    recording.value = false;
    recorder.stop();
  }

  onScopeDispose(() => {
    if (recorder && recording.value) recorder.stop();
    releaseStream();
  });

  return { available, recording, transcribing, error, refreshAvailability, start, stop };
}
