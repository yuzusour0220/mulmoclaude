// Collects CSP violations reported by sandboxed views (#1989). A view whose
// resource is blocked posts an `mc-csp-violation` message up to the host; we
// dedupe by blocked host + directive, cap the list, and expose it so the UI
// can surface an actionable notice ("add this host to config/csp.json")
// instead of the resource failing silently. Host-global (a single window
// listener) so it works no matter which view triggered it. The message is
// informational and carries no capability, so a loose validation is fine.

import { ref, readonly } from "vue";

export interface CspViolation {
  /** Origin of the blocked resource, e.g. `https://www.google.com` — this is
   *  the exact host the user would add to `config/csp.json`. */
  host: string;
  /** The blocked directive, e.g. `frame-src`. */
  directive: string;
}

const MAX_VIOLATIONS = 5;
const violationsState = ref<CspViolation[]>([]);

export const cspViolations = readonly(violationsState);

export function dismissCspViolations(): void {
  violationsState.value = [];
}

function originOf(uri: string): string {
  try {
    return new URL(uri).origin;
  } catch {
    return uri;
  }
}

interface ViolationMessage {
  type: string;
  blockedURI?: unknown;
  violatedDirective?: unknown;
  effectiveDirective?: unknown;
}

function isViolationMessage(data: unknown): data is ViolationMessage {
  return typeof data === "object" && data !== null && (data as { type?: unknown }).type === "mc-csp-violation";
}

// Pure: turn a raw `mc-csp-violation` payload into a `{ host, directive }` the
// UI can act on, or `null` when it's not a fixable-by-config violation.
// Exported for unit tests.
export function parseCspViolationMessage(data: unknown): CspViolation | null {
  if (!isViolationMessage(data)) return null;
  const blockedURI = typeof data.blockedURI === "string" ? data.blockedURI : "";
  const rawDirective =
    typeof data.violatedDirective === "string" ? data.violatedDirective : typeof data.effectiveDirective === "string" ? data.effectiveDirective : "";
  // `inline` / `eval` violations aren't fixable by adding a host to config, so
  // don't surface them as "add this host" notices.
  if (!blockedURI || blockedURI === "inline" || blockedURI === "eval") return null;
  return { host: originOf(blockedURI), directive: rawDirective.split(" ")[0] || "" };
}

function recordViolation(violation: CspViolation): void {
  if (violationsState.value.some((entry) => entry.host === violation.host && entry.directive === violation.directive)) return;
  violationsState.value = [violation, ...violationsState.value].slice(0, MAX_VIOLATIONS);
  const directiveSuffix = violation.directive ? ` (${violation.directive})` : "";
  console.warn(`[csp] blocked ${violation.host}${directiveSuffix}. To allow it, add the host to config/csp.json — but only if you trust it.`);
}

function onMessage(event: MessageEvent): void {
  // Only accept reports from an opaque-origin (sandboxed) frame — our custom
  // views run `sandbox="allow-scripts"` with no `allow-same-origin`, so a
  // legitimate report always arrives with `event.origin === "null"`. This
  // rejects a spoofed "add this host to config/csp.json" banner posted by an
  // ALLOWED external iframe (e.g. a Google Maps embed), which carries its real
  // origin. The banner is informational (no auto-action), so this proportionate
  // check is enough without threading iframe refs into this host-global listener.
  if (event.origin !== "null") return;
  const violation = parseCspViolationMessage(event.data);
  if (violation) recordViolation(violation);
}

let installed = false;
export function installCspViolationListener(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("message", onMessage);
}
