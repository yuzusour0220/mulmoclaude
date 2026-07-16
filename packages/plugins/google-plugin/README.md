# @mulmoclaude/google-plugin

MulmoClaude runtime plugin exposing the user's **locally linked Google
account** to the chat agent as one `google` tool (kind-discriminated
dispatch). Server-only — no Vue View.

- Engine: `@mulmoclaude/core/google` (OAuth loopback + PKCE, token store at
  `~/.config/mulmoclaude/google-token.json`, Calendar v3 REST). The settings
  UI, remote-host commands, `yarn google:auth`, and this tool share one link
  state.
- Kinds: `status`, `calendarListEvents`, `calendarCreateEvent`. Tasks / Drive
  (`drive.file`) ride the same consent grant later (issue #2115).
- Not linked yet? The tool's errors tell the LLM to guide the user to
  Settings → Plugins → Google (or `yarn google:auth`).

## Dev loop

```bash
yarn workspace @mulmoclaude/google-plugin run build
yarn workspace @mulmoclaude/google-plugin run test
```
