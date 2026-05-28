// Email plugin — server-side runtime plugin (v1 scaffold, #1542).
//
// One tool (`manageEmail`), four kinds (`list` / `read` / `search`
// / `send`). v1 scaffold returns stub responses for the I/O kinds
// so the configuration flow can be exercised end-to-end; real
// IMAP/SMTP wiring lands in PR 2 (list/read/search) and PR 3
// (send with the human-confirmation gate). See #1542.
//
// Send-gate contract: the first `kind:'send'` call (with no
// `confirmed:true`) returns a structured payload that the host
// renders as a presentForm confirmation. The LLM then re-calls
// with `confirmed:true` only after the user has approved the
// form. The dispatch refuses to send without `confirmed:true`.

import { definePlugin } from "gui-chat-protocol";

import { TOOL_DEFINITION } from "./definition";
import { Args, type EmailArgs } from "./args";
import { loadConfig, missingConfigResponse, serverUnknownResponse, type ResolvedEmailConfig } from "./config";

export { TOOL_DEFINITION };

// v1 scaffold — every I/O handler is a stub that proves the
// dispatch reaches it. PR 2 / PR 3 swap these for real imapflow
// + nodemailer calls. Each returns a JSON-serialisable shape so
// the MCP bridge can stringify it into `message` for the LLM.

interface StubResponse {
  ok: true;
  stub: string;
  kind: string;
  echoed_args: Record<string, unknown>;
}

function stub(kind: string, args: Record<string, unknown>): StubResponse {
  return {
    ok: true,
    stub: "email-plugin v1 scaffold — IMAP/SMTP wiring lands in PR 2/3 (#1542). Args echoed for end-to-end testing.",
    kind,
    echoed_args: args,
  };
}

function handleList(_cfg: ResolvedEmailConfig, args: Extract<EmailArgs, { kind: "list" }>): StubResponse {
  return stub("list", { mailbox: args.mailbox, limit: args.limit });
}

function handleRead(_cfg: ResolvedEmailConfig, args: Extract<EmailArgs, { kind: "read" }>): StubResponse {
  return stub("read", { mailbox: args.mailbox, uid: args.uid });
}

function handleSearch(_cfg: ResolvedEmailConfig, args: Extract<EmailArgs, { kind: "search" }>): StubResponse {
  return stub("search", {
    mailbox: args.mailbox,
    limit: args.limit,
    from: args.from,
    subject_contains: args.subject_contains,
    since: args.since,
    before: args.before,
    unread: args.unread,
  });
}

// Send is special: returns a confirmation envelope (NOT a stub
// send result) when `confirmed !== true`. The host renders this
// as a presentForm; the user approves; the LLM re-calls with
// `confirmed:true`.
interface SendConfirmRequest {
  needs_confirmation: true;
  message: string;
  draft: { to: string; subject: string; body: string; html?: string };
  retry_with: { kind: "send"; to: string; subject: string; body: string; html?: string; confirmed: true };
}

function buildSendConfirmation(args: Extract<EmailArgs, { kind: "send" }>): SendConfirmRequest {
  return {
    needs_confirmation: true,
    message:
      "About to send email. Show the user the draft below and ask them to confirm. " +
      "Only call `manageEmail` again with `confirmed:true` after the user explicitly approves.",
    draft: { to: args.to, subject: args.subject, body: args.body, ...(args.html ? { html: args.html } : {}) },
    retry_with: { kind: "send", to: args.to, subject: args.subject, body: args.body, ...(args.html ? { html: args.html } : {}), confirmed: true },
  };
}

function handleSend(_cfg: ResolvedEmailConfig, args: Extract<EmailArgs, { kind: "send" }>): StubResponse | SendConfirmRequest {
  if (args.confirmed !== true) return buildSendConfirmation(args);
  return stub("send", { to: args.to, subject: args.subject });
}

type Handled = StubResponse | SendConfirmRequest;

function dispatch(cfg: ResolvedEmailConfig, args: EmailArgs): Handled {
  switch (args.kind) {
    case "list":
      return handleList(cfg, args);
    case "read":
      return handleRead(cfg, args);
    case "search":
      return handleSearch(cfg, args);
    case "send":
      return handleSend(cfg, args);
    default: {
      const exhaustive: never = args;
      throw new Error(`unknown manageEmail kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export default definePlugin(({ files }) => {
  return {
    TOOL_DEFINITION,

    async manageEmail(rawArgs: unknown) {
      const resolution = await loadConfig(files);
      if (resolution.kind === "missing") return missingConfigResponse();
      if (resolution.kind === "server_unknown") return serverUnknownResponse(resolution.email);

      const parsed = Args.safeParse(rawArgs);
      if (!parsed.success) {
        return { instructions: `Invalid manageEmail arguments: ${parsed.error.issues.map((issue) => issue.message).join("; ")}` };
      }

      try {
        const result = dispatch(resolution.config, parsed.data);
        return { message: JSON.stringify(result) };
      } catch (err) {
        return { instructions: `manageEmail call failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  };
});
