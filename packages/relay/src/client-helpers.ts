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

export function parseRelayMessage(data: unknown): RelayMessage | null {
  if (typeof data !== "string") return null;
  try {
    const msg: RelayMessage = JSON.parse(data);
    return msg;
  } catch {
    return null;
  }
}
