// `fetch` with a finite timeout, ported from the host (`server/utils/fetch.ts`)
// so the Google engine carries no dependency on host utils (same convention as
// `collection/registry/server/fetch.ts`).

import { ONE_SECOND_MS } from "./util.js";

export const DEFAULT_FETCH_TIMEOUT_MS = 10 * ONE_SECOND_MS;

// `Parameters<typeof fetch>[1]` avoids referencing the ambient `RequestInit`
// type, which ESLint's `no-undef` rule trips over in the server config.
export type FetchWithTimeoutInit = Parameters<typeof fetch>[1] & { timeoutMs?: number };

/** `fetch` with a finite timeout. Rejects with a `TimeoutError` once
 *  `timeoutMs` elapses. Composes with a caller-supplied `signal` so external
 *  cancellation still works. */
export async function fetchWithTimeout(url: string | URL, init: FetchWithTimeoutInit = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_FETCH_TIMEOUT_MS, signal: callerSignal, ...rest } = init;

  if (callerSignal?.aborted) {
    throw callerSignal.reason ?? new DOMException("Aborted", "AbortError");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException(`fetch timed out after ${timeoutMs}ms`, "TimeoutError"));
  }, timeoutMs);

  const unsubscribeCaller = bridgeExternalSignal(callerSignal, controller);

  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    unsubscribeCaller?.();
  }
}

function bridgeExternalSignal(external: AbortSignal | null | undefined, controller: AbortController): (() => void) | null {
  if (!external) return null;
  const onAbort = () => controller.abort(external.reason);
  external.addEventListener("abort", onAbort, { once: true });
  return () => external.removeEventListener("abort", onAbort);
}
