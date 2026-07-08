/** Ancestor directory paths of a workspace-relative file, ordered
 *  shallowest-first and EXCLUDING the file's own leaf. Returns `[]` for
 *  a root-level file (or empty input) since it has no directory to load.
 *  Leading and duplicate slashes are dropped as empty segments. */
export function computeAncestorDirs(filePath: string): string[] {
  const parts = filePath.split("/").filter(Boolean);
  if (parts.length <= 1) return [];
  const ancestors: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    ancestors.push(parts.slice(0, i).join("/"));
  }
  return ancestors;
}
