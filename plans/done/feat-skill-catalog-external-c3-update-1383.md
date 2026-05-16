# C3 (scoped) — external-repo Update button (#1383)

Final slice of #1383 (PR-C). C1 (#1386 backend) + C2 (#1392 UI)
merged. This delivers **only the per-repo Update button**; the rest of
the original C3 (scheduler / SHA-pin / update notifications) is
**de-scoped** — #1383 closes after this lands.

## Why no backend change

C1's `installExternalRepo({ url, subpath?, ref? })` already:
fetches latest (`cloneOrUpdate` → `git fetch --depth=1 HEAD` +
checkout), wipes + re-copies the catalog dir, rewrites `.source.json`
with the new SHA. The repoId-collision guard passes for the same repo
(same canonical URL). So **"update" == re-install with the repo's
recorded url/subpath** — the frontend already has `repo.url` /
`repo.subpath` from `GET /external/repos`. No new endpoint.

Star = fork still holds: re-install only refreshes the catalog layer;
already-starred copies in `.claude/skills/` are untouched (consistent
with uninstall semantics).

## Changes (frontend only)

- `src/plugins/manageSkills/View.vue`
  - `updatingRepoId` ref (spinner / disable gate, like
    `uninstallingRepoId`).
  - `updateRepo(repo: ExternalRepo)`: POST `externalReposInstall`
    with `{ url: repo.url, subpath?: repo.subpath }`; on ok
    `Promise.all([loadExternalRepos(), loadCatalog()])`; on error set
    `catalogError`. No modal involved.
  - Repo-header row: add a refresh icon-button between the count and
    the uninstall button, `data-testid="skill-catalog-repo-update-{repoId}"`,
    disabled while `updatingRepoId === repoId`.
- i18n: one new key `pluginManageSkills.catalogUpdateRepo` across all
  8 locales (lockstep).
- `docs/ui-cheatsheet.md`: add the update button + testid to the
  `/skills` block.

## Tests

`e2e/tests/skills.spec.ts` — extend the external-catalog describe:
click `skill-catalog-repo-update-anthropics-skills`, assert a POST to
`/api/skills/external/repos` fired with the repo's url/subpath and the
list refreshed. (Reuses the existing `setupExternalCatalog` mocks; the
install route already records POST bodies.)

## Out of scope (closing #1383, not deferring)

- Scheduler / periodic auto-update
- SHA-pin / ref lock UI
- "upstream has changes" bell notifications

## Acceptance

- Each installed repo shows an Update button; clicking it re-fetches
  upstream and refreshes the catalog (new skills appear, removed ones
  drop) without touching starred copies.
- 8 locales updated; cheatsheet updated; e2e + full suite green;
  `format`/`lint`/`typecheck`/`build`/`test` clean.
- #1383 closed after merge with a note that scheduler/SHA-pin/
  notifications were intentionally de-scoped.
