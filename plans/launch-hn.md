# HN Submission Plan

Everything you need to submit MulmoClaude to Hacker News. Read top to bottom on submission day.

---

## Pre-submit checklist

Do these IN ORDER before clicking Submit.

- [ ] **The PR is merged to `main`.** The HN link goes to `main`; if the PR is still open, HN readers see the old README.
- [ ] **Visit https://github.com/receptron/mulmoclaude in a private/incognito browser tab.** Confirm the new platform-positioning hero ("MulmoClaude is an open-source, AI-native application platform...") and the MANIFEST.md blockquote are visible at the top.
- [ ] **Check the time.** Submit only **Tuesday / Wednesday / Thursday, 8–11am Pacific Time** (Tuesday best, Wednesday good, Thursday acceptable). Avoid Fridays and weekends entirely. Also avoid days with major AI announcements (Anthropic / OpenAI / Google keynotes, model launches) — your post will drown.
- [ ] **First comment is in your clipboard** (the block below in this file). The maker comment must appear within ~60 seconds of submission.
- [ ] **You have 6 hours free** to respond to comments after submitting. The first 6 hours determine ranking more than the title does.

---

## Submission fields

Go to https://news.ycombinator.com/submit. Three fields:

### title (copy exactly)

```
Show HN: MulmoClaude – open-source platform where Claude composes tools and GUIs
```

Notes:
- The dash is `–` (en dash, `Option+-` on Mac, U+2013). HN accepts both `–` and `-`; `–` reads cleaner.
- 80 chars — at HN's 80 char limit; reads cleanly.

### url (copy exactly)

```
https://github.com/receptron/mulmoclaude
```

### text (leave EMPTY)

Do not fill in this field. The first comment goes as a manual comment after submitting, where it's editable for ~2 hours.

---

## Click Submit. Then immediately post this as the first comment:

```
Maker here.

MulmoClaude lets one chat session drive multiple apps and GUI surfaces.

Examples running on it today:

- **Accounting** — full bookkeeping with server-side business logic
- **Personal wiki** — search, edit, and cross-link knowledge over time
- **Financial Advisor** — analyzes SEC filings via the Edgar plugin
- **Encore** — natural-language definition of recurring obligations, executed by a DSL engine
- **Storyteller** — interactive illustrated stories with generated images

Claude (via the Claude Agent SDK) acts as a universal controller over a plugin registry — composing across plugins via MCP tools.

Three architectural commitments:

**Chat summons GUIs** — the agent's reply isn't a string. It picks a format for the content: Markdown for prose, MCP tool invocations for GUI surfaces (chart, form, wiki, spreadsheet, 3D scene), MulmoScript for multimedia. The chat input is the address bar; what arrives is whatever the content demands.

**Cross-plugin composition** — each plugin contributes one or more MCP tools to the agent. The agent composes across them in one turn. "Summarize Q1 expenses as a chart" reads accounting, writes chart. No app-switching, no copy-paste between apps.

**Open protocol (gui-chat-protocol extending MCP)** — the agent↔GUI contract is a versioned npm package, not an internal API. Plugins are distributed as npm packages; any future agent host that implements the protocol can run them. The protocol sits on top of MCP — it adds the visual layer that MCP doesn't cover.

The architectural argument is in [MANIFEST.md](https://github.com/receptron/mulmoclaude/blob/main/MANIFEST.md) — three commitments (universal controller / chat summons GUIs / open protocol extending MCP) plus the patterns proven by the accounting and Encore plugins.

Install: see the [Quick Start in the README](https://github.com/receptron/mulmoclaude#quick-start) — needs Node 20+ and the Claude Code CLI installed and OAuth'd.

Three things I'd genuinely value HN feedback on:

1. What other plugin patterns (beyond *API+UI+Agent* and *NL→DSL→engine*) should this architecture handle?
2. Is `gui-chat-protocol` the right abstraction shape for "the agent and the GUI need to talk"?
3. Does the **agent-as-universal-controller** framing hold up against your mental model of MCP?
```

---

## First 6 hours: engagement playbook

- **Refresh the HN page every 10–15 minutes.** Reply to every comment.
- **Lead with acknowledgment.** "Good question" / "You're right that..." opens better than "Actually..."
- **Clarify, don't argue.** If someone misunderstands, restate; don't push back on tone.
- **If someone is wrong about a fact**: "Yes, and the nuance is..." not "No, you're wrong."
- **If someone is hostile**: still answer the technical substance, ignore the tone. The thread audience reads tone; punishing matched hostility is the default HN move.
- **If you don't know**: say so. "I don't know, but my guess is X — would value your read on this."
- **Don't argue with downvotes.** Just keep engaging substantively.

Stop after ~6 hours. Diminishing returns past that, and threads drift.

---

## Common objections — pre-written replies

Paste-ready answers for objections that commonly come up in Show HN threads. Pull from these when relevant; don't dump them all at once.

### "Why not MCP?"

> MCP solves agent ↔ tool access. MulmoClaude adds three things MCP doesn't cover:
>
> 1. **GUI rendering** — what happens when a tool result is a UI surface (chart, form, wiki, spreadsheet, 3D scene), not just data
> 2. **Agent ↔ UI communication** — pub/sub channels, scoped REST dispatch, locale, error isolation
> 3. **Cross-plugin composition** — agent orchestrating across multiple plugins in a single turn
>
> Think of MCP as transport. `gui-chat-protocol` is presentation + state, sitting on top of MCP, not next to it.

### "Why not just use Claude Desktop?"

> Claude Desktop gives you one agent with tools. MulmoClaude is a platform where applications themselves are composable plugins with GUI surfaces — accounting, wiki, Financial Advisor, Storyteller, etc. — and Claude composes across them in a single turn. Different layer of the stack.

### "Why not just build this in React/Vue/Svelte?"

> You still can — and we do (MulmoClaude's frontend is Vue). The interesting question isn't the rendering framework; it's *where the orchestration lives*. In a traditional web app, the frontend orchestrates which views/components to render. MulmoClaude moves orchestration into the agent layer: the agent decides which plugin to invoke, which GUI surface to render, and how to compose across plugins. The rendering still happens in your framework of choice; the orchestration logic doesn't.

---

## What to expect

- **Best case**: front page, 200+ upvotes, 50–100 comments, traffic spike, GitHub stars, install attempts.
- **Median case**: 30–80 upvotes, 10–30 comments, modest traffic. Still valuable signal.
- **Worst case**: dies in /new with single-digit upvotes. Move on; the manifesto and repo still benefit.

HN is lottery-like. Title + timing + first 6 hours of comments matter more than the project quality, frustratingly. Don't read karma as quality.

---

## After HN

- **Save the HN URL** to share on X/LinkedIn after.
- **Wait ~10 days** for HN traffic peak to recede before PH launch.
- **Watch GitHub Issues** for installs that fail — common HN traffic outcome.
- **Reach out to commenters who installed it** with friendly follow-up.
