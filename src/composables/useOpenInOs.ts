import { ref, watch, type Ref } from "vue";
import { apiPost } from "../utils/api";
import { API_ROUTES } from "../config/apiRoutes";

// UI state + trigger for the "Open in OS" button on the binary-file
// fallback in FileContentRenderer. Extracted so the state machine
// (busy / error / auto-reset on path change) is unit-testable
// without mounting the full component.
//
// - `selectedPath` is watched: when it changes, error + busy reset
//   so an error from file A doesn't linger while viewing file B.
// - `fallbackErrorMessage` is used when the server returns `ok:
//   false` without an `error` string.

export interface UseOpenInOsResult {
  busy: Ref<boolean>;
  error: Ref<string | null>;
  open: () => Promise<void>;
}

export function useOpenInOs(selectedPath: Ref<string | null>, fallbackErrorMessage: () => string): UseOpenInOsResult {
  const busy = ref(false);
  const error = ref<string | null>(null);

  watch(selectedPath, () => {
    busy.value = false;
    error.value = null;
  });

  async function open(): Promise<void> {
    const path = selectedPath.value;
    if (!path) return;
    busy.value = true;
    error.value = null;
    try {
      const url = `${API_ROUTES.files.open}?path=${encodeURIComponent(path)}`;
      const result = await apiPost<{ ok: boolean }>(url, { path });
      if (!result.ok) error.value = result.error || fallbackErrorMessage();
    } finally {
      busy.value = false;
    }
  }

  return { busy, error, open };
}
