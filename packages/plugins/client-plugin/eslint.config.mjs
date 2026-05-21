// Plugin-author ESLint config — extends gui-chat-protocol's preset to
// ban node:fs / node:path / console / direct fetch in plugin source so
// platform bypasses surface at lint time.

import tseslint from "typescript-eslint";
import vueParser from "vue-eslint-parser";
import pluginPreset from "gui-chat-protocol/eslint-preset";

export default [
  { files: ["src/**/*.ts"], languageOptions: { parser: tseslint.parser, parserOptions: { ecmaVersion: "latest", sourceType: "module" } } },
  { files: ["src/**/*.vue"], languageOptions: { parser: vueParser, parserOptions: { parser: tseslint.parser, ecmaVersion: "latest", sourceType: "module" } } },
  ...pluginPreset.map((entry) => ({ ...entry, files: ["src/**/*.{ts,vue}"] })),
];
