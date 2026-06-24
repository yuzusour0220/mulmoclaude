import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_WHISPER_MODEL, WHISPER_MODELS, isWhisperModelName, resolveModelName } from "../../../../server/system/whisper/models.ts";
import { buildWav16kArgs } from "../../../../server/utils/audio/ffmpeg.ts";
import { isAppSettings, isAppSettingsPatch } from "../../../../server/system/config.ts";

describe("whisper model registry", () => {
  it("recognizes registered model names and rejects others", () => {
    assert.equal(isWhisperModelName("large-v3-turbo"), true);
    assert.equal(isWhisperModelName("small"), true);
    assert.equal(isWhisperModelName("nonsense"), false);
    assert.equal(isWhisperModelName(42), false);
    assert.equal(isWhisperModelName(undefined), false);
  });

  it("resolves unknown / missing names to the default", () => {
    assert.equal(resolveModelName("base"), "base");
    assert.equal(resolveModelName("nonsense"), DEFAULT_WHISPER_MODEL);
    assert.equal(resolveModelName(undefined), DEFAULT_WHISPER_MODEL);
  });

  it("default model is present in the registry with a sane size floor", () => {
    const spec = WHISPER_MODELS[DEFAULT_WHISPER_MODEL];
    assert.ok(spec.url.startsWith("https://"));
    assert.ok(spec.file.endsWith(".bin"));
    assert.ok(spec.minBytes > 0);
  });
});

describe("ffmpeg wav args", () => {
  it("targets 16 kHz mono pcm_s16le with input/output in place", () => {
    const args = buildWav16kArgs("/tmp/in.webm", "/tmp/out.wav");
    assert.deepEqual(args, ["-y", "-loglevel", "error", "-i", "/tmp/in.webm", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", "/tmp/out.wav"]);
  });
});

describe("AppSettings voiceInput validation", () => {
  it("accepts a well-formed voiceInput block", () => {
    assert.equal(isAppSettings({ extraAllowedTools: [], voiceInput: { enabled: true, model: "small" } }), true);
    assert.equal(isAppSettings({ extraAllowedTools: [], voiceInput: { enabled: false } }), true);
  });

  it("rejects a malformed voiceInput block", () => {
    assert.equal(isAppSettings({ extraAllowedTools: [], voiceInput: { enabled: "yes" } }), false);
    assert.equal(isAppSettings({ extraAllowedTools: [], voiceInput: { model: 7 } }), false);
  });

  it("patch validator accepts a partial voiceInput", () => {
    assert.equal(isAppSettingsPatch({ voiceInput: { enabled: true } }), true);
    assert.equal(isAppSettingsPatch({ voiceInput: { enabled: 1 } }), false);
  });
});
