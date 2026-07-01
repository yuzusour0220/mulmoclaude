// Download an artifacts/html page as a self-contained zip from the host
// UI (file explorer preview). Mirrors usePdfDownload: POST the workspace
// path to /api/share/pack, receive a binary zip, run the
// blob-to-download dance. Failure sets `packFailed` so the caller can
// render a localized message — the raw server body is never surfaced.

import { ref, type Ref } from "vue";
import { API_ROUTES } from "../config/apiRoutes";
import { apiFetchRaw } from "../utils/api";

export interface UseSharePackHandle {
  packing: Ref<boolean>;
  packFailed: Ref<boolean>;
  downloadZip: (htmlPath: string) => Promise<void>;
}

function fallbackName(htmlPath: string): string {
  const base =
    htmlPath
      .split("/")
      .pop()
      ?.replace(/\.html?$/i, "") || "share";
  return `${base}.zip`;
}

function filenameFromDisposition(header: string | null, fallback: string): string {
  const match = header ? /filename="?([^";]+)"?/.exec(header) : null;
  return match ? match[1] : fallback;
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function useSharePack(): UseSharePackHandle {
  const packing = ref(false);
  const packFailed = ref(false);

  async function downloadZip(htmlPath: string): Promise<void> {
    packFailed.value = false;
    packing.value = true;
    try {
      const response = await apiFetchRaw(API_ROUTES.share.pack, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: htmlPath }),
      });
      if (!response.ok) {
        packFailed.value = true;
        return;
      }
      saveBlob(await response.blob(), filenameFromDisposition(response.headers.get("content-disposition"), fallbackName(htmlPath)));
    } catch {
      packFailed.value = true;
    } finally {
      packing.value = false;
    }
  }

  return { packing, packFailed, downloadZip };
}
