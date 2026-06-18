// Wire @mulmoclaude/collection-plugin/server to MulmoClaude's workspace,
// logger, and path layout. Imported for side effect at the very top of
// server/index.ts so the binding is set before any collection storage
// operation runs. MulmoTerminal has its own equivalent shim.
import path from "node:path";
import { configureCollectionHost } from "@mulmoclaude/collection-plugin/server";
import { workspacePath } from "../workspace.js";
import { log } from "../../system/logger/index.js";
import { WORKSPACE_DIRS } from "../paths.js";
import { USER_SKILLS_DIR, projectSkillsDir } from "../skills/paths.js";
import { feedsRoot } from "../feeds/paths.js";
import { isPresetSlug } from "../skills-preset.js";

configureCollectionHost({
  workspaceRoot: workspacePath,
  log,
  paths: {
    userSkillsDir: USER_SKILLS_DIR,
    projectSkillsDir,
    feedsRoot,
    skillsStagingDir: (root) => path.join(root, WORKSPACE_DIRS.skillsStaging),
    archiveDir: WORKSPACE_DIRS.archive,
  },
  isPresetSlug,
});
