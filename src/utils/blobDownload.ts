// Shared browser blob-download helpers used by the share composables
// (useSharePack, useMarkdownZip). Keeps the createObjectURL → click →
// revoke dance and the Content-Disposition filename parsing in one place.

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function filenameFromDisposition(header: string | null, fallback: string): string {
  const match = header ? /filename="?([^";]+)"?/.exec(header) : null;
  return match ? match[1] : fallback;
}
