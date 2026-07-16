import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// Server-only plugin: one entry, no Vue. `gui-chat-protocol` and `zod`
// are inlined (same strategy as edgar-plugin) so the bundled
// `dist/index.js` resolves when the runtime loader extracts a tarball
// without node_modules. `@mulmoclaude/core` stays external — it is a
// real dependency the host always ships, and inlining it would fork
// the token-store state away from the host's copy.
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
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: [/^node:/, /^@mulmoclaude\/core/],
    },
    minify: false,
    sourcemap: true,
  },
});
