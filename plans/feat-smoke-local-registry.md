# feat: Decouple the `smoke` tarball test from public npm (eliminate publish-before-merge)

## Problem

A PR that bumps a launcher-pinned shared `@mulmoclaude/*` package **cannot go
green without publishing that package to public npm first** — a chicken-and-egg
with the ideal "publish from `main` after merge" release flow.

Root cause: the `smoke` job (`scripts/mulmoclaude/tarball.mjs`) `npm pack`s the
launcher and `npm install`s the `.tgz` into a clean dir via
`{ mulmoclaude: "file:<tgz>" }`. That install resolves the launcher's
`@mulmoclaude/*` **dependencies from the public npm registry** (a real end-user
install, no workspace fallback). So a launcher pinned to an unpublished
`@mulmoclaude/core@^0.12.0` / `collection-plugin@^0.7.3` fails with
`ETARGET No matching version found` → smoke red. (Hit in PR #1993; the
launcher-sync gate stayed green because it is npm-agnostic — only `smoke` forces
the publish.)

## Goal

A PR can bump + validate a shared-package version **without** publishing to public
npm. Public publish moves to a clean post-merge release step.

## Options

### Option A — Verdaccio throwaway local registry (highest fidelity, recommended)

In the smoke workflow: start [Verdaccio](https://verdaccio.org/) on localhost,
`npm publish` every workspace `@mulmoclaude/*` package (already built by the smoke
build step) to it, then run the tarball install with
`--registry http://localhost:4873`. The launcher's first-party deps resolve to the
just-built workspace versions; third-party deps still come from the real registry
(Verdaccio proxies uplinks).

- **Pro:** exercises real `npm publish` + `npm install` semantics against the
  actual built artifacts — closest to today's fidelity, minus the public publish.
- **Con:** adds a service to the CI job (startup, config, `.npmrc`/auth-token
  scoping so only `@mulmoclaude:` routes to Verdaccio).

### Option B — npm `overrides` → locally-packed `.tgz` (lighter)

Extend `buildInstallerPackageJson` (`scripts/mulmoclaude/tarball.mjs`) to `npm
pack` each workspace `@mulmoclaude/*` dep and add an `overrides` map pointing each
`@mulmoclaude/<name>` at its local `file:<tgz>` in the installer `package.json`.

- **Pro:** no extra service; a targeted change to one script + its unit tests
  (`buildInstallerPackageJson` is already unit-tested).
- **Con:** relies on npm resolving **transitive** `file:` overrides correctly
  (npm ≥ 8.3); fiddlier for scoped/peer deps; slightly less "real" than a registry.

## The fidelity tradeoff (decide before implementing)

Either option means `smoke` **no longer catches "you forgot to publish a
first-party dep"** — it always uses the local build. That check must move to the
release/publish step (the `/publish` skill already verifies a package's deps are
published before publishing it). Confirm that relocation is acceptable to the
maintainer; it is the one real regression in test coverage.

## Non-goals

- Not changing what `smoke` asserts post-install (boot → `/` 200, sandbox files,
  plugin list) — only *where the first-party deps come from*.
- Not touching the launcher-sync gate (already npm-agnostic and correct).

## Provenance

Split out of PR #1993 (remote offline queue). See the "Implementation order"
note in `plans/feat-remote-offline-queue.md` and the memory
`feedback_bump_in_pr_publish_after_merge` for the constraint this removes.
