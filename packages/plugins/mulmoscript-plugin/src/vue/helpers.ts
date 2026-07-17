// Pure helpers for the presentMulmoScript View. Kept separate so their
// logic is unit-testable without mounting the Vue component. Ported from
// the host's `src/plugins/presentMulmoScript/helpers.ts`; the SSE-stream
// helpers did not move — per-beat generation progress now arrives on the
// plugin pubsub channel (see `core/contract.ts`).

import { isRecord } from "./support";

/**
 * Decide whether a beat should be rendered automatically at
 * script load time. Text-based beats (slides, charts, etc.) are
 * auto-rendered only when the script has no characters —
 * characters must be rendered first so they can be referenced by
 * any character-using beat.
 */
export function shouldAutoRenderBeat(beat: { image?: { type?: string } }, hasCharacters: boolean, autoRenderTypes: readonly string[]): boolean {
  if (hasCharacters) return false;
  const type = beat.image?.type;
  if (typeof type !== "string") return false;
  return autoRenderTypes.includes(type);
}

/**
 * Of the given character keys, return those whose image is not
 * yet loaded and is not currently rendering. Used to fetch only
 * what's missing after a movie-generation event arrives.
 */
export function getMissingCharacterKeys(keys: readonly string[], images: Record<string, unknown>, renderState: Record<string, string | undefined>): string[] {
  return keys.filter((charKey) => !images[charKey] && renderState[charKey] !== "rendering");
}

/**
 * A schema shape that exposes `safeParse` — matches Zod's API
 * without pulling the dep into this module.
 */
export interface SafeParseSchema {
  safeParse: (value: unknown) => { success: boolean };
}

/**
 * Validate a candidate Beat JSON string against a schema.
 * Returns false on any JSON parse error or schema mismatch.
 */
export function validateBeatJSON(json: string, schema: SafeParseSchema): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return false;
  }
  return schema.safeParse(parsed).success;
}

/**
 * Stable structural equality for two MulmoScripts via JSON
 * canonicalisation. We compare the full re-serialised string
 * rather than walking keys because (a) MulmoScript is
 * deeply-nested and Object.keys-recursion would be ~50 lines, and
 * (b) `JSON.stringify` already preserves insertion order, which
 * `mulmoScriptSchema.safeParse` keeps stable across runs of the
 * same input. False positives (= "differ" when they don't) only
 * cost an extra `emit("updateResult", ...)` which is a no-op when
 * data hasn't actually changed.
 */
export function isSameScript(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * True when a beat can have a generated video clip on disk — used to
 * decide whether to probe the beat-movie endpoint. `moviePrompt`
 * beats produce a per-beat movie file; `html_tailwind` beats with
 * `animation` set (either `true` or an options object) produce an
 * `_animated.mp4` render.
 */
export function beatMayHaveMovie(beat: { moviePrompt?: string; image?: { type?: string; animation?: unknown } }): boolean {
  if (beat.moviePrompt) return true;
  return beat.image?.type === "html_tailwind" && Boolean(beat.image.animation);
}

/** Pure check: is every beat in the script a `slide`-typed beat?
 *  When true, the View mounts `@mulmocast/deck-web`'s
 *  `MulmoScriptDeckEditor` instead of the per-beat list UI (#1575).
 *  Empty / missing `beats[]` returns false — there's nothing to edit
 *  as a deck, fall through to the existing UI which renders an empty
 *  state. Mixed scripts (any non-`slide` beat) also return false; that
 *  case is deferred to a future phase. */
export function isAllSlideDeck(script: unknown): boolean {
  if (!isRecord(script)) return false;
  const { beats } = script;
  if (!Array.isArray(beats) || beats.length === 0) return false;
  return beats.every((beat) => {
    if (!isRecord(beat)) return false;
    const { image } = beat;
    return isRecord(image) && image.type === "slide";
  });
}
