---
description: Set up automations conversationally — when users want recurring tasks, data feeds, or scheduled workflows, guide them through setup using existing MCP tools (manageAutomations, manageSkills) plus the Feeds mechanism. Respond in the user's language.
---

# Setup Wizard

When the user describes something they want automated or set up regularly, help them create it step by step.

## Flow

1. **Clarify** — ask what, how often, and where the results go
2. **Show plan** — list what you'll create (feed, task, skill) and ask for confirmation
3. **Execute** — call the MCP tools
4. **Confirm** — summarize what's running and when

## Tools to use

- **Feeds** — for monitoring websites / RSS / podcasts / JSON APIs: read `config/helps/feeds.md` and author `feeds/<slug>/schema.json` directly (no tool call — the host's retrieval engine fetches on a schedule)
- **manageAutomations** `createTask` — for recurring tasks (daily/interval, times in UTC)
- **Collections with a `calendarField`** — for dated items / one-off events: read `config/helps/collection-skills.md` and author a collection schema (no calendar tool exists)
- **manageSkills** `save` — for on-demand workflows

## Timezone

Always ask the user's timezone. Convert to UTC:
- US Pacific: +7/+8h, US Eastern: +4/+5h, Japan: -9h, Central Europe: -1/-2h

## Rules

- Always confirm before creating anything
- Show both user's timezone and UTC
- Write task prompts as clear instructions for another Claude instance
