// presentForm's validation + execute now live in the shared @mulmoclaude/form-plugin
// package. Re-exported here so existing importers (the server dispatch route, the
// plugin index) keep working unchanged.
export { executeForm } from "@mulmoclaude/form-plugin";
export { TOOL_NAME, TOOL_DEFINITION } from "./definition";
