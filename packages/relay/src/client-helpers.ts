// Pure helpers for the relay WebSocket client.
//
// Extracted from createRelayClient so the URL-building, backoff, and
// message-parsing logic can be unit-tested without a live WebSocket.

import type { RelayMessage } from "./types.js";

export const INITIAL_BACKOFF_MS = 1000;
export const MAX_BACKOFF_MS = 30000;
export const BACKOFF_MULTIPLIER = 2;

export function buildRelayUrl(baseUrl: string, token: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

export function nextBackoffMs(currentMs: number): number {
  return Math.min(currentMs * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);
}

// `{ ok: false }` is distinct from a successfully-parsed `null` payload:
// the source JSON `"null"` parses to `null` and must still reach
// `onMessage`, whereas a non-string frame or malformed JSON must not.
// Collapsing to `RelayMessage | null` would drop the former.
export type ParsedRelayMessage = { ok: true; msg: RelayMessage } | { ok: false };

export function parseRelayMessage(data: unknown): ParsedRelayMessage {
  if (typeof data !== "string") return { ok: false };
  try {
    const msg: RelayMessage = JSON.parse(data);
    return { ok: true, msg };
  } catch {
    return { ok: false };
  }
}
