import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// Isomorphic core: pure TS (no Vue), consumed by BOTH the host server
// (node/tsx) and the host frontend (vite). Dual ESM + CJS so the Docker
// CJS server build can `require` it (the package.json `require` condition
// points at the .cjs artifact). Vue surfaces will be a separate ./vue entry.
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
      // `.` = isomorphic core (schema + pure engine), imported by the host
      // frontend AND server. `./server` = node-only storage engine (fs/path),
      // imported only by the host server — kept out of `.` so the frontend
      // bundle never pulls in node:fs. `./vue` = browser UI layer (composition
      // API; Vue components land here too), imported only by the host frontend.
      entry: { index: "src/index.ts", server: "src/server/index.ts", vue: "src/vue/index.ts" },
      formats: ["es", "cjs"],
      fileName: (format, entryName) => `${entryName}.${format === "es" ? "js" : "cjs"}`,
    },
    rollupOptions: {
      // node built-ins + zod + gui-chat-protocol + vue stay external (resolved
      // from node_modules at runtime); only the package's own modules are bundled.
      external: [/^node:/, "zod", "gui-chat-protocol", "vue"],
      output: { exports: "named" },
    },
    minify: false,
    sourcemap: true,
  },
});
