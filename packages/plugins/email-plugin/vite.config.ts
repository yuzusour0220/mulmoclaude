import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// Server-only plugin (v1): one entry, no Vue View yet. Mirrors
// the externals strategy from edgar-plugin / bookmarks-plugin —
// `gui-chat-protocol` and `zod` are bundled inline so the runtime
// loader can extract the published tarball into a cache dir
// without needing the user to `npm install` peer deps.
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
      external: ["node:os", "node:url"],
    },
    minify: false,
    sourcemap: true,
  },
});
