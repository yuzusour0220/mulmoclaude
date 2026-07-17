// Pure path helpers for MulmoScript story artifacts. No Node built-ins so the
// package stays bundler-agnostic (chart/html precedent); all filesystem access
// happens through the host's generic `files.artifacts` FileOps.
//
// Path model: the stories directory lives at `<workspace>/artifacts/stories`
// and the FileOps scope root is `<workspace>/artifacts`, so the
// FileOps-relative path and the historical `stories/<name>.json` wire form
// (which every mulmoScript endpoint keys on) are the SAME string. Helpers
// below therefore return one path used for both purposes.

const STORIES_DIR = "stories";
const MAX_SLUG_LEN = 120;

/** Lowercase-hyphen slug, capped at MAX_SLUG_LEN, with leading/trailing
 *  hyphens stripped. Falls back to `fallback` for empty/undefined/non-ASCII
 *  input. Mirrors html-plugin's in-package slugify — deliberately simpler
 *  than the host's hash-fallback variant; the timestamp suffix appended by
 *  `storyFilePath` keeps these throwaway filenames collision-free. */
export function slugify(title: string | undefined, fallback = "story"): string {
  if (!title) return fallback;
  const collapsed = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, MAX_SLUG_LEN);
  let start = 0;
  let end = collapsed.length;
  while (start < end && collapsed[start] === "-") start += 1;
  while (end > start && collapsed[end - 1] === "-") end -= 1;
  return collapsed.slice(start, end) || fallback;
}

/** Build a fresh, collision-safe story path for a new script —
 *  `stories/<slug>-<epoch-ms>.json`, valid as both the FileOps-relative
 *  write path and the wire `filePath`. */
export function storyFilePath(slugSource: string, now: Date = new Date()): string {
  return `${STORIES_DIR}/${slugify(slugSource)}-${now.getTime()}.json`;
}

/**
 * Normalize a caller-supplied wire path to the canonical
 * `stories/<rel>` form, or null when it can't be trusted. Accepts both the
 * canonical `stories/foo.json` convention and bare `foo.json` (the host route
 * historically allowed either). Rejects absolute paths, backslashes, and any
 * empty / `.` / `..` segment — the lexical guard before every
 * `files.artifacts` read/write (FileOps re-checks containment as
 * defence-in-depth).
 */
export function normalizeStoryPath(filePath: string): string | null {
  if (filePath.length === 0 || filePath.includes("\\")) return null;
  // Absolute POSIX path or Windows drive prefix.
  if (filePath.startsWith("/") || /^[A-Za-z]:/.test(filePath)) return null;
  const segments = filePath.split("/");
  if (segments.some((seg) => seg === "" || seg === "." || seg === "..")) return null;
  const rest = segments[0] === STORIES_DIR ? segments.slice(1) : segments;
  if (rest.length === 0) return null;
  return [STORIES_DIR, ...rest].join("/");
}
