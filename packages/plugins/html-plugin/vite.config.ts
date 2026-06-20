import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// Server-only plugin (phase 1): one entry, no Vue. Mirrors x-plugin /
// edgar-plugin's build. This package is imported directly by the host
// server build (like @mulmoclaude/{form,markdown,chart}-plugin), so it
// reaches host backends only through the generic gui-chat-protocol
// `files.artifacts` capability — no Node built-ins, nothing to bundle.
//
// Phase 2 (the Vue View) adds a second `vue` lib entry + tailwind here,
// matching chart-plugin's two-entry config.
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
      // Dual ESM + CJS so `require("@mulmoclaude/html-plugin")` works under
      // the host's Docker CJS mode (the package.json `require` condition
      // points at the .cjs artifact). Named exports only — no default.
      formats: ["es", "cjs"],
      fileName: (format, entryName) => `${entryName}.${format === "es" ? "js" : "cjs"}`,
    },
    rollupOptions: {
      external: ["gui-chat-protocol"],
      output: { exports: "named" },
    },
    minify: false,
    sourcemap: true,
  },
});
