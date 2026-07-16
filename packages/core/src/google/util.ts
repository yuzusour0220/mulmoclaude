// Small helpers ported from the host (`server/utils/{errors,text,time,types}.ts`)
// so the Google engine carries no dependency on host utils — same convention
// as `collection/registry/server/fetch.ts`.

export const ONE_SECOND_MS = 1_000;
export const ONE_MINUTE_MS = 60_000;

export function errorMessage(err: unknown, fallback = "unknown error"): string {
  if (err instanceof Error) return err.message || fallback;
  const text = String(err);
  return text === "" || text === "[object Object]" ? fallback : text;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Clip a string to at most `max` chars; the ellipsis is included in the
 *  budget so output never exceeds `max`. */
export function truncate(text: string, max: number, ellipsis = "…"): string {
  if (max <= 0) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - ellipsis.length))}${ellipsis}`;
}
