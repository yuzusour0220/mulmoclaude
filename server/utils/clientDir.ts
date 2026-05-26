export function resolveClientDir(envValue: string | undefined, defaultDir: string): string {
  if (typeof envValue === "string") {
    const trimmed = envValue.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return defaultDir;
}
