import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// Phase-1 server-only plugin: one entry, no Vue (mirrors x-plugin's build).
// The core deliberately uses NO Node built-ins (chart/html precedent) so the
// host's client-side definition shim can import TOOL_DEFINITION from `.`
// without dragging server code into the browser bundle. `@mulmocast/types`
// carries the zod schemas and is a runtime import — externalized so both
// hosts resolve their own copy (version lockstep with `mulmocast`).
export default defineConfig({
  plugins: [
    dts({
      include: ["src/**/*.ts"],
      outDir: "dist",
      compilerOptions: { rootDir: "src" },
    }),
  ],
  build: {
    lib: {
      entry: { index: "src/index.ts" },
      // Dual ESM + CJS so `require("@mulmoclaude/mulmoscript-plugin")` works
      // under the host's Docker CJS mode (the package.json `require`
      // condition points at the .cjs artifact). Named exports only.
      formats: ["es", "cjs"],
      fileName: (format, entryName) => `${entryName}.${format === "es" ? "js" : "cjs"}`,
    },
    rollupOptions: {
      external: ["@mulmocast/types", "gui-chat-protocol"],
      output: { exports: "named" },
    },
    minify: false,
    sourcemap: true,
  },
});
