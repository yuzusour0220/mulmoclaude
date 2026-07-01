// Download an artifacts/html page as a self-contained zip from the host
// UI (file explorer preview). Mirrors usePdfDownload: POST the workspace
// path to /api/share/pack, receive a binary zip, run the
// blob-to-download dance. Any failure sets packError for the caller to
// render below the button.

import { ref, type Ref } from "vue";
import { API_ROUTES } from "../config/apiRoutes";
import { apiFetchRaw } from "../utils/api";
import { errorMessage } from "../utils/errors";

export interface UseSharePackHandle {
  packing: Ref<boolean>;
  packError: Ref<string | null>;
  downloadZip: (htmlPath: string) => Promise<void>;
}

function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const match = /filename="?([^";]+)"?/.exec(header);
  return match ? match[1] : fallback;
}

export function useSharePack(): UseSharePackHandle {
  const packing = ref(false);
  const packError = ref<string | null>(null);

  async function downloadZip(htmlPath: string): Promise<void> {
    packError.value = null;
    packing.value = true;
    let url: string | null = null;
    try {
      // Returns a binary zip, not JSON — use the raw Response escape
      // hatch so we can call `.blob()` ourselves.
      const response = await apiFetchRaw(API_ROUTES.share.pack, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: htmlPath }),
      });
      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        packError.value = `Share error ${response.status}: ${errText}`;
        return;
      }
      const blob = await response.blob();
      const fallback = `${
        htmlPath
          .split("/")
          .pop()
          ?.replace(/\.html?$/i, "") || "share"
      }.zip`;
      const filename = filenameFromDisposition(response.headers.get("content-disposition"), fallback);
      url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
    } catch (err) {
      packError.value = errorMessage(err);
    } finally {
      if (url) URL.revokeObjectURL(url);
      packing.value = false;
    }
  }

  return { packing, packError, downloadZip };
}
