import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

// Two entries: the server-facing `.` core (save/update executes + tool
// definition, imported by the host server build) and the browser `./vue`
// (View/Preview). `vue` + `gui-chat-protocol/vue` are externalised so the
// plugin and host share ONE instance (the injected PLUGIN_RUNTIME_KEY Symbol
// must match); `@mulmocast/*` are externalised so both hosts resolve their
// own copies (version lockstep with `mulmocast`). Mirrors html-plugin's
// config. Declarations are emitted by vue-tsc (tsconfig.build.json) because
// vite-plugin-dts and the Vue SFC transform disagree about .vue d.ts paths.
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        vue: resolve(__dirname, "src/vue/index.ts"),
      },
      name: "GUIChatPluginMulmoScript",
      formats: ["es", "cjs"],
      fileName: (format, entryName) => `${entryName}.${format === "es" ? "js" : "cjs"}`,
    },
    rollupOptions: {
      external: ["vue", "gui-chat-protocol", "gui-chat-protocol/vue", "@mulmocast/types", "@mulmocast/deck-web"],
      output: {
        exports: "named",
        globals: { vue: "Vue" },
        assetFileNames: "style.[ext]",
      },
    },
    cssCodeSplit: false,
    minify: false,
    sourcemap: true,
  },
});
