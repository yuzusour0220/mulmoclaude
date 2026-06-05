// Centralized gate for "are you sure?" prompts before a destructive
// item action (deleting a todo card, calendar event, etc.). A thin
// wrapper around `window.confirm` so the wording / UI can be swapped
// to a styled modal in one place without touching every call site,
// and so tests have a single seam to stub instead of monkey-patching
// `window.confirm` per spec.
//
// Callers own the message and its localization — this helper is just
// the gate that returns true iff the user accepted.

export function confirmItemDelete(message: string): boolean {
  return window.confirm(message);
}
