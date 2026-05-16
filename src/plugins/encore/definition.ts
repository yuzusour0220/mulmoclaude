// MCP ToolDefinition for `manageEncore`. The argument shape is a
// discriminated union on `kind`; the LLM picks the action it wants
// and supplies the relevant fields. Schema details live in the help
// file (`config/helps/encore-dsl.md`) which the host syncs into the
// workspace at every startup — keeping this `description` short and
// letting Claude lazy-read the help file for full grammar is the
// teaching strategy (see plans/feat-encore-plugin.md "Teaching the
// DSL to Claude").

import type { ToolDefinition } from "gui-chat-protocol";

export const TOOL_NAME = "manageEncore";

export const ENCORE_KINDS = [
  "setup",
  "amendDefinition",
  "markStepDone",
  "markTargetSkipped",
  "recordValues",
  "query",
  "appendNote",
  "snooze",
  "resolveNotification",
] as const;

const toolDefinition: ToolDefinition = {
  type: "function",
  name: TOOL_NAME,
  prompt:
    "Track recurring obligations (monthly payments, biannual taxes, annual services) defined in the Encore DSL. " +
    "Use setup to create a new obligation from a complete DSL document; amendDefinition to update one; " +
    "markStepDone / markTargetSkipped / recordValues to record what happened in a cycle; " +
    "query to read obligation and cycle history (returns workspace-relative paths so you can deep-read raw files); " +
    "appendNote to write free-form notes onto an obligation or cycle body; " +
    "snooze to defer a notification. " +
    "Read `helps/encore-dsl.md` for the full DSL grammar and three worked examples (monthly-payments, real-estate-tax, annual-physical).",
  description:
    "Manage recurring obligations defined in the Encore DSL — payments and services with cadence, targets, steps, and firing plans.",
  parameters: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: [...ENCORE_KINDS],
        description: "Which Encore action to perform.",
      },
    },
    required: ["kind"],
    // The handler validates the rest of the args per-kind with Zod
    // (see src/plugins/encore/server.ts). Keeping the top-level
    // schema minimal lets Claude compose any shape and surface
    // structural errors via the help-file-pointer messages, rather
    // than fighting a strict JSON-schema validator that doesn't
    // know about cross-field rules.
    additionalProperties: true,
  },
};

export default toolDefinition;
