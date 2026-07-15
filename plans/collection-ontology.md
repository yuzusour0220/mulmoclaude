# feat(collections): operational ontology — the curated set

Date: 2026-07-15
Origin: Foundry analysis ([@gura105](https://x.com/gura105/status/2077153028982133080), "ontology = reverse domain modeling") → design proposal → curation pass. This doc records **what we adopt, what we redesigned, and what we deliberately rejected**, so the rejected parts don't get re-proposed from scratch later.

## Selection principle

The host gets a feature only when it is **declarative, derivable from schemas, and fail-soft**. Anything requiring judgment or connector knowledge stays in **prose** (templates + roles + MCP tools). Foundry backs its kinetic layer with TypeScript; we back ours with natural language executed by an LLM — that twist is the product, so we double down on it instead of importing write governance.

Corollary (**lint, not lock**): files are the source of truth and the agent/user can always edit records directly, so Foundry's "no direct write path" invariant is fundamentally unimportable. Guards are enforced on the *governed* paths (UI, `putItems`) where a rejected row with a `problem` message doubles as agent feedback, and *reported* on ungoverned paths by the post-hoc scan (`validateCollectionRecords`) — never hard-enforced over files.

## Current-state map (implementation footholds)

- **Field types**: `CollectionFieldType` — `packages/core/src/collection/core/schema.ts:65-96`; zod mirror `server/discovery.ts:129-147`. Computed/display-only types (`derived`, `embed`, `toggle`) in `COMPUTED_TYPES` — `server/validate.ts:27` — never persisted.
- **`ref`**: one-directional, stores the target's primaryKey slug (string, not numeric) — `schema.ts:350-357`. No reverse/backlink concept exists.
- **Deref loading**: server `loadLinkedTargets` loads every ref/embed target collection once per enrich — `server/derive.ts:64-72`; client fan-out `useLinkedCollectionCaches.ts:94-108`. Unknown target ⇒ null ⇒ em-dash (fail-soft).
- **Formula evaluator**: pure eval-free recursive-descent interpreter, `+ - * /` + parens + single `sum()` over same-table columns; **deliberately no string literals / conditionals / nested calls** — `core/derivedFormula.ts:6-33`. Saturation in `core/deriveAll.ts` runs **identically on server and client** so numbers never diverge.
- **Discovery-time validation**: cross-collection targets are validated for slug *safety* only, never existence (target may not be loaded yet); resolution fails soft at render — `discovery.ts:479-486`. Schema-level refines that check sibling fields: `discovery.ts:651-820`.
- **Actions**: `CollectionActionKind = "chat"` only; **`"mutate"` is already reserved by comment** — `schema.ts:174-178`. Record-level `actions` + collection-level `collectionActions` (`schema.ts:461`) both exist. Action `when` is **already re-checked server-side** — `server/api/routes/collections.ts:368-375` via `actionVisible` (`core/actionVisible.ts:23-40`).
- **Seed builders**: per-record `buildActionSeedPrompt` (security boundary + full sanitized record JSON + template) — `server/io.ts:463-473`; collection-level `buildCollectionActionSeedPrompt` (progress summary) — `io.ts:496-511`.
- **Hidden workers**: agent-ingest `refreshViaAgent` — `packages/core/src/feeds/server/agentIngest.ts:44-94`. `FeedsHost.spawnWorker` DI seam; `hidden: true` ⇒ `origin: system`; manual Refresh runs visible. Dispatch-time `lastFetchedAt` stamp prevents double-dispatch (`agentIngest.ts:88-89`). Deduped failure bell + clear-on-success — `agentIngest.ts:107-139`.
- **Write path**: `putItems` → `validateRecordObject` (primaryKey/filename match, required, enum membership — nothing else) — `server/validate.ts:102-117`. No business rules, no record-provenance flag anywhere.
- **`spawn`**: host-native successor creation, already shares `when`/`set`/`carry` vocabulary — `schema.ts:157-172`, `server/spawn.ts`.
- **Graph precedent**: wiki link graph — `packages/core/src/wiki/graph.ts`. No collection-level runtime graph exists; `discoverCollections` (`discovery.ts:980-996`) is the enumeration entry point.

## Adopted features, in build order

### 0. Prerequisite: zod as the single source of truth for schema types

Schema validation is already zod (`CollectionSchemaZ`, `discovery.ts:535`; zod 4 already a core dep) — but zod is a **hand-maintained mirror** of the hand-written interfaces in `core/schema.ts`, with no `z.infer` / `satisfies` tie between them. `z.object` strips unknown keys by default, so an interface-only addition is **silently deleted from every parsed schema** at runtime. Every feature below adds new schema keys; fix the foundation first.

**Phase A — single source of truth (blocking for everything below):** ✅ DONE 2026-07-15 (`core/schemaZ.ts` + derived types in `core/schema.ts` / `core/where.ts` / feeds `ingestTypes.ts`; pure predicates split into `core/ids.ts` / `core/templatePath.ts`).
- Move zod definitions to a dedicated `core/schemaZ.ts`; `core/schema.ts` derives all types via `import type` + `z.infer<typeof …>`, deleting the hand-written interfaces. `import type` keeps zod out of the browser bundle (the Vue plugin imports runtime values like `deriveAll` from `@mulmoclaude/core/collection` — the zod module must not ride along).
- Convert `FieldSpecSchema` (flat bag of ~12 optional keys + 7 chained refines) to `z.discriminatedUnion("type", […])` — one variant per field type declaring only its own keys. Ditto `ActionSpecSchema` on `kind`. Each ontology feature then lands as a clean new union member instead of more refine soup, with precise error messages for schema authors (including the agent via `putSchema`). Schema-level cross-field refines (when.field names a real field, etc.) stay as-is.
- Zero behavior change intended; golden-test that existing `schema.json` fixtures parse identically. Doc comments migrate onto the zod defs — they're load-bearing.

**Phase B — compiled zod record validators (can overlap with 1–2; must land before `mutate`):** ✅ DONE 2026-07-15 (`core/recordZ.ts`: `compileRecordZ(schema, tier)` with `"enforced"` = exact historical write-gate checks and `"strict"` = report-only per-type lint; `validateRecordObject` keeps its loose default while `validateCollectionRecords` scans strict).
- Generate a per-collection zod validator from `CollectionSchema` (fields → `z.object`) and use it in `validateRecordObject` — initially reproducing *exactly* today's three checks (primaryKey/filename match, required non-empty, enum membership; `validate.ts:102-117`). No tightening on day one.
- Per-type tightening (numbers are numbers, dates parse, table rows conform — a string in a `number` field passes today) goes **report-only first** via `validateCollectionRecords`: existing records were written under loose rules, and flipping strictness on `putItems` immediately would spray rejections at the agent. Promote checks to enforcing once the lint runs clean — lint-not-lock applied to our own migration.
- `mutate`'s `params` form validation (step 4) is a mini record-validation and must come from this same compiler, not a third mechanism.

### 1. `getOntology` — machine-readable workspace ontology (LLM first, panel later)

A `manageCollection getOntology` verb (or equivalent): iterate `discoverCollections()`, emit per collection `{ slug, title, icon, primaryKey, displayField, recordCount, relations[] }` where relations are outbound `ref` / `embed` (and later `backlinks` / `rollup`) declarations with field names. Derived on demand — no authoring, no storage, always in sync.

- LLM summary ships **first** (it lets the assistant answer cross-silo questions without re-reading every schema — the self-improving-agent payoff). The user-facing `/collections` graph panel (Mermaid or wiki-graph-style; borrow from `wiki/graph.ts`) is phase 2.
- Deliberately NOT a unified enterprise schema: collections stay bounded contexts; the LLM does semantic joining at read time.

### 2. `backlinks` — display-only reverse refs

New computed field type (joins `COMPUTED_TYPES`): stores nothing; detail view renders a read-only sub-table of records in `from` whose `via` ref points at this record.

```jsonc
// clients/schema.json
"openInvoices": {
  "type": "backlinks",
  "label": "Invoices",
  "from": "invoice",
  "via": "clientId",
  "display": ["issueDate", "total", "status"],
  "filter": { "field": "status", "in": ["draft", "sent"] }   // CollectionWhen shape
}
```

- **Validation contract**: shape-only at discovery (slug-safe `from`, non-empty `via`/`display`); existence of `from`, the `via` ref field, and `display` columns resolve **fail-soft at render** (empty sub-table / em-dash) — same contract as `embed` and deref, per `discovery.ts:479-486`. Do NOT attempt cross-schema existence checks at discovery.
- Loading: extends the `loadLinkedTargets` / `useLinkedCollectionCaches` fan-out to *reverse* sources — new plumbing on both server enrich and client cache paths, same load-whole-collection-per-open model. Refresh on reload, not live.
- Each row links to `/collections/<from>?selected=<id>`.

### 3. `kind: "agent"` actions — silent per-record/per-collection workers

Fill the reserved 2×2: chat/agent × record/collection. Same `CollectionAction` shape, new kind:

```jsonc
"actions": [{
  "id": "reprice", "label": "Refresh price", "icon": "sync",
  "kind": "agent", "role": "investor", "template": "templates/reprice.md",
  "when": { "field": "status", "in": ["active"] }
}]
```

- Button → hidden worker (`origin: system`) seeded with `buildActionSeedPrompt` (record-level) or `buildCollectionActionSeedPrompt` (collection-level) → worker edits records via `manageCollection` → finishes silently.
- Reuse agent-ingest's failure bell (deduped, cleared on success) and its **stamp-at-dispatch** pattern as a per-record dispatch guard (double-click ⇒ one worker). Spinner on the button while running.
- New plumbing: expose the `spawnWorker` seam (currently `FeedsHost`) to the collections action route.
- `when` re-checked server-side, as chat actions already are.
- Template convention: end with "edit the record and stop — do not present anything."

### 4. `kind: "mutate"` — declarative host-executed writes

The reserved kind from `schema.ts:174-178`, exactly Foundry's Action shape minus the lock:

```jsonc
"actions": [{
  "id": "assign", "label": "Assign", "icon": "person_add",
  "kind": "mutate",
  "require": { "field": "status", "in": ["open"] },        // CollectionWhen; re-checked server-side
  "params": { "assignee": { "type": "string", "label": "Assignee", "required": true } },
  "set": { "assignee": "$params.assignee", "status": "assigned" }
}]
```

- No LLM invocation — deterministic one-click writes shouldn't burn tokens.
- `set` values: literals or `$params.<name>`; merge semantics (only named fields change). Half-states are unconstructible **through this path**; the file path stays open by design (lint, not lock).
- Rejected governed writes return a `problem` row — that's agent feedback, not just an error.
- `toggle` stays a field type (inline checkbox UX) — NOT rewritten as mutation sugar. `spawn` stays separate (creates rather than mutates) but already shares the vocabulary.

### 5. `rollup` — cross-collection aggregate over a backlink relation

**Redesigned from the original `sumOver(...)` formula syntax**, which would have broken the evaluator's no-string-literals boundary (`derivedFormula.ts:24-28`). Instead: structured schema riding on backlinks' vocabulary and resolution machinery.

```jsonc
// clients/schema.json
"unbilledHours": {
  "type": "rollup",
  "label": "Unbilled hours",
  "from": "worklog", "via": "clientId",                    // same shape as backlinks
  "op": "sum", "column": "hours",                          // ops: sum | count — stop there
  "filter": { "field": "billed", "in": ["false"] }
}
```

- Evaluator untouched. Fail-soft to em-dash like all derefs. `count` needs no `column`.
- **Server/client parity**: `deriveAll` runs on both sides with identical inputs; the client must load the same reverse-source collections with the same snapshot, or values diverge. Sequenced after backlinks precisely because it inherits that loading work.
- No rollups inside arithmetic formulas until a real schema demands it.

## Rejected / deferred — and why (don't re-propose without new evidence)

- **`egress` write-back block (host machinery)** — REJECTED. Lifecycle triggers + debounce + loop guards = enterprise sync infrastructure, and a two-masters conflict problem that contradicts files-as-source-of-truth. The proposal's loop guard ("worker-originated writes carry a flag") is not implementable: record files carry no provenance, and the raw Write escape hatch bypasses any tool-layer flag. **Write-back ships as a prose pattern instead**: a collection-level `kind: "agent"` "Sync" action (or scheduled automation) whose template diffs against a last-synced snapshot file kept in the collection dir (workspace-is-the-database sync state), records remote ids in `externalId`, and pushes via MCP. Deliverable: a help file under `packages/core/assets/helps/` + one reference template (remember to bump `@mulmoclaude/core`). Caveat to document there: interactively-authenticated MCP servers may be absent for hidden/headless workers. Promote to host machinery only if real usage proves the pattern common AND the prose version insufficient.
- **`transitions` enum state machine** — DEFERRED (pull-based). Most lock-shaped piece; the LLM already reads legal states from schema prose, and no current collection demands it. If a real schema needs it: edit-form dropdown filtering + kanban drop bounce + `putItems` rejection with `problem` + post-hoc lint — never a hard invariant over files. Note: enforcement requires the write path to read the previous record (upsert/merge don't compare old values today).
- **`sumOver()` formula-string syntax** — REJECTED in favor of `rollup` (above).
- **Rewriting `toggle` as mutation sugar** — REJECTED. Category mismatch (inline checkbox vs button+form); would regress UX for zero gain.
- **Unified workspace-wide schema** — REJECTED, per the original proposal's own DDD reservation. The graph gives visibility without the trap.

## Sequencing

```
⓪ zod single-source refactor  — Phase A blocks everything; Phase B blocks ④ (mutate params)
① getOntology (LLM summary)   — trivial, helps everything downstream
② backlinks                   — render-only, establishes from/via vocabulary + reverse loading
③ kind:"agent" actions        — infra exists end-to-end; completes the 2×2
④ kind:"mutate"               — fills the reserved slot; guards as paved path
⑤ rollup                      — rides on ②'s machinery
⑥ egress pattern doc          — falls out of ③ for free (help file + template, no host code)
```

Each step is independently shippable and backward compatible (all new schema surface is opt-in).

## One-line summary

Keep schemas as the semantic layer; grow the kinetic layer our way — deterministic one-click writes for the schema-shaped 90%, silent prose-driven workers for the judgment 10%, relationships surfaced (backlinks, rollups, ontology graph) rather than governed — and leave write governance and sync infrastructure in Foundry, where the org-chart that needs them lives.
