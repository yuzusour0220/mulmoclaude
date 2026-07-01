// Duplicate of the host's `src/utils/markdown/useMermaid.ts` — kept
// separate so the plugin doesn't pull the host Vue tree into its
// bundle. Behavior is identical.

import { onMounted, watch, nextTick, type Ref } from "vue";
import { renderMermaidNodes } from "./mermaidRender";

export function useMermaidRenderer(containerRef: Ref<HTMLElement | null | undefined>, sourceRef: Ref<unknown>): void {
  const run = async (): Promise<void> => {
    await nextTick();
    await renderMermaidNodes(containerRef.value ?? null);
  };
  onMounted(() => {
    void run();
  });
  watch(sourceRef, () => void run(), { flush: "post" });
}
