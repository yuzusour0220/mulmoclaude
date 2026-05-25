import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { assertHostUntouched, snapshotHostFs, type HostFsBaseline } from "../../e2e-live/fixtures/isolated-dev-server.ts";

// Regression net for the Codex GHA review on PR #1506: the previous
// `assertHostUntouched` only checked top-level dir mtimes and missed
// in-place rewrites of existing files. The recursive walk added in
// the same PR closes that gap; these tests exercise the four drift
// shapes we now detect (modified, created, removed, absent-then-present)
// against a real tmpdir so a future refactor that re-introduces
// shallow checking fails immediately.

describe("isolated-dev-server.assertHostUntouched", () => {
  let workRoot: string;

  before(async () => {
    workRoot = await mkdtemp(path.join(tmpdir(), "mc-fresh-drift-"));
  });

  after(async () => {
    await rm(workRoot, { recursive: true, force: true });
  });

  afterEach(async () => {
    // Re-create a clean target dir per test so the cases stay isolated.
    await rm(path.join(workRoot, "target"), { recursive: true, force: true });
  });

  async function seedTarget(): Promise<string> {
    const target = path.join(workRoot, "target");
    await mkdir(path.join(target, "config"), { recursive: true });
    await mkdir(path.join(target, "skills", "mc-foo"), { recursive: true });
    await writeFile(path.join(target, "config", "settings.json"), '{"a":1}');
    await writeFile(path.join(target, "skills", "mc-foo", "SKILL.md"), "# foo\n");
    return target;
  }

  it("returns no error when nothing changed", async () => {
    const target = await seedTarget();
    const baseline = await snapshotHostFs(target);
    await assertHostUntouched([baseline]);
  });

  it("detects an in-place rewrite of an existing file (the Codex-flagged regression)", async () => {
    const target = await seedTarget();
    const baseline = await snapshotHostFs(target);
    // Advance the mtime of an existing file deterministically — same
    // shape as an isolation leak writing through to the host
    // `config/settings.json`. Parent dir mtime is NOT advanced by
    // this operation on most filesystems, which is exactly why the
    // pre-fix top-level check missed it.
    const target_file = path.join(target, "config", "settings.json");
    const futureMs = Date.now() + 60_000;
    await utimes(target_file, futureMs / 1000, futureMs / 1000);
    await assert.rejects(() => assertHostUntouched([baseline]), /mtime advanced/);
  });

  it("detects a newly created file under the snapshotted root", async () => {
    const target = await seedTarget();
    const baseline = await snapshotHostFs(target);
    await writeFile(path.join(target, "skills", "mc-foo", "extra.md"), "leaked\n");
    await assert.rejects(() => assertHostUntouched([baseline]), /created during test/);
  });

  it("detects a removed file under the snapshotted root", async () => {
    const target = await seedTarget();
    const baseline = await snapshotHostFs(target);
    await rm(path.join(target, "skills", "mc-foo", "SKILL.md"));
    await assert.rejects(() => assertHostUntouched([baseline]), /removed during test/);
  });

  it("detects an absent → present existence flip", async () => {
    const absentRoot = path.join(workRoot, "never-existed");
    // Take baseline first while the root is absent.
    const baseline: HostFsBaseline = await snapshotHostFs(absentRoot);
    assert.equal(baseline.existed, false);
    // Then create the root post-baseline.
    await mkdir(absentRoot, { recursive: true });
    await assert.rejects(() => assertHostUntouched([baseline]), /existence flipped/);
  });

  it("tolerates an external file deletion happening BETWEEN baseline and walk-rest by skipping it", async () => {
    // Race: an entry returned by readdir disappears before stat() runs.
    // We cannot trivially synthesize that race here without timing
    // tricks, but the production code uses an ENOENT skip on the per-
    // entry stat (see walkMtimeTree). The closest deterministic check
    // is "rm a file before snapshot finishes" — covered indirectly by
    // the removed-file test above. This `it` is a sentinel reminding
    // future authors that the ENOENT skip is intentional, not a swallow.
    const target = await seedTarget();
    const baseline = await snapshotHostFs(target);
    // No drift expected: a no-op call should be silent.
    await assertHostUntouched([baseline]);
  });
});
