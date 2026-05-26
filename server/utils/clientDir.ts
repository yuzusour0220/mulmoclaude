export function resolveClientDir(envValue: string | undefined, defaultDir: string): string {
  if (typeof envValue === "string" && envValue.trim().length > 0) return envValue;
  return defaultDir;
}
