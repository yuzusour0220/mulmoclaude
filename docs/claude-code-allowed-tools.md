# Claude Code `allowedTools` リファレンス / `allowedTools` Reference

最終確認 / Last verified: 2026-05-28
公式ドキュメント / Official docs: <https://code.claude.com/docs/en/permissions.md>

## 概要 / Overview

**JA**: Claude Code CLI（Anthropic 公式バイナリ）の `--allowed-tools` / 設定ファイルの `permissions.allow` には**3 種類の値**が書けます。CLI 側にツール一覧を吐き出すコマンドはなく、設定ファイルと公式ドキュメントが唯一の信頼できる出所です。MulmoClaude は `server/agent/backend/claude-code.ts` で `extraAllowedTools` をこの CLI に直接渡します。

**EN**: Claude Code CLI's `--allowed-tools` flag and the `permissions.allow` setting accept values from **three categories**. The CLI does not expose a "list available tools" command; the settings file and the official docs are the only authoritative sources. MulmoClaude forwards `extraAllowedTools` straight into this CLI via `server/agent/backend/claude-code.ts`.

## 1. 値の3カテゴリ / Three categories

| カテゴリ / Category | 構文 / Syntax | 例 / Example |
|---|---|---|
| **組み込み / Built-in** | ツール名そのまま (PascalCase) / Tool name as-is (PascalCase) | `Bash`, `Read`, `Edit`, `Write` |
| **MCP ツール / MCP tool** | `mcp__<server>__<tool>` (ワイルドカード可 / wildcard allowed) | `mcp__puppeteer__navigate`, `mcp__puppeteer__*`, `mcp__puppeteer` |
| **サブエージェント / Subagent** | `Agent(<name>)` | `Agent(Explore)`, `Agent(my-custom-agent)` |

## 2. 組み込みツール語彙 / Built-in tool vocabulary

| 名前 / Name | 用途 / Purpose |
|---|---|
| `Bash` | シェルコマンド実行 / Shell command execution |
| `Read` | ファイル読み取り（テキスト・PDF・画像・notebook） / Read files (text, PDF, images, notebooks) |
| `Edit` | 既存ファイルの差分編集 / Diff-edit an existing file |
| `Write` | ファイル新規作成 or 全文書き換え / Create file or overwrite |
| `Glob` | パターンマッチでファイル列挙 / List files by glob pattern |
| `Grep` | リポジトリ全文検索 (ripgrep ベース) / Repo-wide search (ripgrep-backed) |
| `WebFetch` | URL を取得して内容を読む / Fetch a URL and read its content |
| `WebSearch` | Web 検索 / Web search |
| `Task` | サブエージェント起動 (`Agent` の別名コンテキスト) / Launch a subagent |
| `TodoWrite` | TODO リスト管理 / Manage a TODO list |
| `NotebookEdit` | Jupyter ノートブックのセル編集 / Edit Jupyter notebook cells |

**JA**: 上記は本リポジトリのセッションで実際に露出している tool 定義から抜き出したもので、Permissions ドキュメントが示す代表例より網羅的です。Claude Code のバージョンアップで増減し得ます。

**EN**: The list above is extracted from the actual tool definitions exposed in this repo's session — broader than the representative samples shown in the Permissions docs. The set may change across Claude Code releases.

## 3. MCP ツールの命名 / MCP tool naming

```text
mcp__<server-name>__<tool-name>   # 特定ツールを許可 / allow one specific tool
mcp__<server-name>__*             # サーバ配下の全ツール / all tools under this server
mcp__<server-name>                # サーバ全体 (短縮形) / shorthand for entire server
```

**JA**: `<server-name>` は MCP 設定 (`~/.claude.json` の `mcpServers` キー、または `.claude/` ディレクトリの設定) のキー名と一致します。MulmoClaude では `server/agent/mcp-server.ts` が stdio JSON-RPC bridge を立てており、サーバ名はそこで決まります。

**EN**: `<server-name>` matches the key under `mcpServers` in `~/.claude.json` (or the `.claude/` directory's config). In MulmoClaude, `server/agent/mcp-server.ts` runs the stdio JSON-RPC bridge; the server name is decided there.

## 4. サブエージェント / Subagents

```text
Agent(<name>)
```

**JA**: `<name>` は `~/.claude/agents/` または `.claude/agents/` に置かれた agent 定義のファイル名 (拡張子なし) です。組み込みの `Explore` / `Plan` / `general-purpose` / `claude` などはユーザ登録不要で常時利用可能。

**EN**: `<name>` is the filename (without extension) of an agent definition in `~/.claude/agents/` or `.claude/agents/`. Built-in agents like `Explore`, `Plan`, `general-purpose`, and `claude` are always available without registration.

## 5. 実行時の確認手段 / How to inspect at runtime

| 手段 / Method | 取れるもの / What you get |
|---|---|
| `/permissions` (対話モード / interactive) | 現在の許可セット (UI 表示) / current allow-set, surfaced in the UI |
| `cat ~/.claude/settings.json` | ユーザスコープの設定 / user-scope config |
| `cat .claude/settings.json` | プロジェクトスコープの設定 / project-scope config |
| `cat ~/.claude.json` | MCP サーバ定義 (`mcpServers` キー) / MCP server definitions |

**JA**: **`claude tools list` 的なコマンドは存在しません**。プログラム的に「現在の Claude Code バイナリが何を露出しているか」を知る正規 API はなく、上の設定ファイルパースとドキュメント参照に頼ります。

**EN**: **There is no `claude tools list` command.** No canonical API exposes "which tools the current Claude Code binary supports" — the only programmatic path is parsing the settings files above + consulting the docs.

## 6. MulmoClaude での実用パターン / Practical pattern in MulmoClaude

**JA**:

- 組み込みツールは**ホスト側コードに enum を写して型ガード**するのが堅実 (CLI バージョンで増減するので、`claude --version` をピンしておくとセーフ)。
- MCP ツールは `mcp.json` から server 名を読み出し、`mcp__${server}__*` を動的合成するのが運用負荷ゼロ。
- サブエージェントは `~/.claude/agents/` を `readdir` して `Agent(${basename})` に展開可能。
- 「現在の CLI が本当に何を露出しているか」を逆引きしたい場合は `permissions.deny: ["*"]` で起動して拒否ログから引き抜く hack はあるが、本番では非推奨。

**EN**:

- Mirror the built-in tool enum in host code and type-gate against it; pin `claude --version` to keep the surface stable.
- For MCP tools, read server names from `mcp.json` and synthesise `mcp__${server}__*` at runtime — zero-maintenance.
- For subagents, `readdir` `~/.claude/agents/` and expand each entry to `Agent(${basename})`.
- To reverse-engineer "what does this CLI binary actually expose", you can launch with `permissions.deny: ["*"]` and harvest from the deny logs — works but not recommended in production.

## 7. 参考リンク / References

- Permissions: <https://code.claude.com/docs/en/permissions.md>
- Settings: <https://code.claude.com/docs/en/settings.md>
- MCP: <https://code.claude.com/docs/en/mcp.md>
