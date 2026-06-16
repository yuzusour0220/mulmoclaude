// Clipboard failures (permissions, insecure context) are swallowed on purpose: the UI just leaves the "Copied!" hint
// off, which is what `copied=false` already signals.

import { ref, type Ref } from "vue";

export interface UseClipboardCopyHandle {
  copied: Ref<boolean>;
  copy: (text: string) => Promise<void>;
}

export function useClipboardCopy(resetMs = 2000): UseClipboardCopyHandle {
  const copied = ref(false);
  let resetTimer: ReturnType<typeof setTimeout> | undefined;

  async function copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      copied.value = true;
      // Cancel any in-flight reset so a quick second copy doesn't get its
      // "Copied!" hint cleared early by the previous timer.
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        copied.value = false;
      }, resetMs);
    } catch {
      // Clipboard API blocked (iframe without permissions, non-HTTPS origin) — leave `copied` false.
    }
  }

  return { copied, copy };
}
