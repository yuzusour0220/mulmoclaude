# @mulmoclaude/google-plugin

MulmoClaude runtime plugin exposing the user's **locally linked Google
account** to the chat agent as one `google` tool (kind-discriminated
dispatch). Server-only — no Vue View.

- Engine: `@mulmoclaude/core/google` (OAuth loopback + PKCE, token store at
  the host-neutral `~/.config/mulmo/google-token.json`, Calendar v3 REST).
  The host's settings UI, remote commands, auth CLI, and this tool share one
  link state — across hosts, too.
- Kinds: `status`, `calendarListEvents`, `calendarCreateEvent`. Tasks / Drive
  (`drive.file`) ride the same consent grant later (issue #2115).
- Not linked yet? The tool's errors tell the LLM to guide the user to this
  app's settings — wording is host-neutral (#2128) because link flows differ
  per host (MulmoClaude: Settings → Plugins → Google or `yarn google:auth`;
  MulmoTerminal: Settings → Google account or `npx mulmoterminal google login`).

## Dev loop

```bash
yarn workspace @mulmoclaude/google-plugin run build
yarn workspace @mulmoclaude/google-plugin run test
```
