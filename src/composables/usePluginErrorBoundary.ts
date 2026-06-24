// State and reset logic for the plugin error boundary mounted in
// `<PluginScopedRoot>`. Extracted from the SFC so the behaviour
// (error capture, details toggle, retry-remount key bump, error
// detail composition) can be unit-tested without a DOM — Codex
// review iter-1 #1147 flagged the absence of automated coverage
// for the boundary's wiring.
//
// The host component still owns `onErrorCaptured` registration —
// that hook must be called inside `setup()` and is not portable —
// but every observable side-effect of "an error was captured" lives
// here and is fully testable in isolation.

import { computed, ref, type ComputedRef, type Ref } from "vue";
import { toError } from "../utils/errors";

export interface PluginErrorBoundary {
  /** Captured error object, or `null` while the plugin renders
   *  normally. The host SFC reads this to switch to the fallback
   *  panel. */
  readonly error: Readonly<Ref<Error | null>>;
  /** Toggle for the "Show details" / "Hide details" disclosure. */
  readonly showDetails: Ref<boolean>;
  /** Bumped on every Retry. The SFC binds it as `<slot :key>` so
   *  Vue treats the slotted subtree as a brand-new component on
   *  each retry — transient bugs (stale refs, momentary endpoint
   *  outages) clear without a full page reload. */
  readonly mountKey: Readonly<Ref<number>>;
  /** Composed `<message>\n\n<stack>` text shown inside the
   *  details `<pre>`. Empty string when there's no error. */
  readonly errorDetails: ComputedRef<string>;
  /** Forward an unknown thrown value into the boundary's error
   *  state. Coerces non-Error throws to `new Error(String(err))`
   *  so `.stack` access stays type-safe in the template. Logs to
   *  the console with a `[plugin/<pkgName>]` prefix so devs can
   *  trace which plugin owned the crash. */
  readonly captureError: (err: unknown) => void;
  /** Clear the error and bump `mountKey`. */
  readonly retry: () => void;
}

/** @param pkgName plugin package name; used as the console log
 *                 prefix so the owning plugin is obvious in dev
 *                 tools. */
export function usePluginErrorBoundary(pkgName: string): PluginErrorBoundary {
  const error = ref<Error | null>(null);
  const showDetails = ref(false);
  const mountKey = ref(0);

  const errorDetails = computed((): string => {
    if (!error.value) return "";
    const message = error.value.message || String(error.value);
    const stack = error.value.stack ?? "";
    return stack ? `${message}\n\n${stack}` : message;
  });

  function captureError(err: unknown): void {
    const captured = toError(err);
    console.error(`[plugin/${pkgName}] uncaught error`, captured);
    error.value = captured;
  }

  function retry(): void {
    error.value = null;
    showDetails.value = false;
    mountKey.value += 1;
  }

  return { error, showDetails, mountKey, errorDetails, captureError, retry };
}
