import { definePlugin } from "gui-chat-protocol";
import { TOOL_DEFINITION } from "./definition";
import { handleManageClient } from "./handlers/llm";

export { TOOL_DEFINITION };

export default definePlugin(({ pubsub, files, log }) => {
  // Serialise read-modify-write through a per-plugin promise chain so
  // parallel save / update / delete calls can't race the on-disk state.
  let writeLock: Promise<unknown> = Promise.resolve();
  function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = writeLock.catch(() => undefined).then(fn);
    writeLock = next.catch(() => undefined);
    return next;
  }

  return {
    TOOL_DEFINITION,

    async manageClient(rawArgs: unknown) {
      return handleManageClient(files, pubsub, log, withWriteLock, rawArgs);
    },
  };
});
