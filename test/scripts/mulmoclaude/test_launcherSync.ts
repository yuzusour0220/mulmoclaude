// Unit tests for scripts/mulmoclaude/launcherSync.mjs.
//
// Each case builds a self-contained fake workspace layout under
// t.diagnostic and drives the auditor against it. No network, no
// snapshot files — the invariant text is asserted inline.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import nodeOs from "node:os";
import * as sync from "../../../scripts/mulmoclaude/launcherSync.mjs";

interface FakePackage {
  name: string;
  version: string;
  peerDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
}

interface Fixture {
  root: Record<string, unknown>;
  launcher: Record<string, unknown>;
  workspaces?: { dir: string; pkg: FakePackage }[];
}

function makeFakeRepo(fixture: Fixture): string {
  const root = mkdtempSync(path.join(nodeOs.tmpdir(), "launcher-sync-"));
  writeFileSync(path.join(root, "package.json"), JSON.stringify(fixture.root, null, 2));
  mkdirSync(path.join(root, "packages", "mulmoclaude"), { recursive: true });
  writeFileSync(path.join(root, "packages", "mulmoclaude", "package.json"), JSON.stringify(fixture.launcher, null, 2));
  for (const entry of fixture.workspaces ?? []) {
    const dir = path.join(root, entry.dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "package.json"), JSON.stringify(entry.pkg, null, 2));
  }
  return root;
}

describe("satisfies", () => {
  it("caret range on 0.y.z lets patches float within the same minor", () => {
    assert.equal(sync.satisfies("0.4.1", "^0.4.0"), true);
    assert.equal(sync.satisfies("0.4.0", "^0.4.0"), true);
    assert.equal(sync.satisfies("0.3.9", "^0.4.0"), false);
    assert.equal(sync.satisfies("0.5.0", "^0.4.0"), false);
  });

  it("caret range on 1.y.z lets minor+patch float within the same major", () => {
    assert.equal(sync.satisfies("1.4.9", "^1.2.0"), true);
    assert.equal(sync.satisfies("2.0.0", "^1.2.0"), false);
  });

  it("exact range requires exact match", () => {
    assert.equal(sync.satisfies("0.4.0", "0.4.0"), true);
    assert.equal(sync.satisfies("0.4.1", "0.4.0"), false);
  });

  it("returns null for URL / workspace / wildcard ranges", () => {
    assert.equal(sync.satisfies("1.2.3", "https://example.com/foo.tgz"), null);
    assert.equal(sync.satisfies("1.2.3", "workspace:*"), null);
    assert.equal(sync.satisfies("1.2.3", "*"), null);
  });
});

describe("auditLauncherSync — invariant 1: root ↔ launcher common dep", () => {
  it("passes when the common dep ranges match", async () => {
    const root = makeFakeRepo({
      root: { name: "monorepo", dependencies: { "gui-chat-protocol": "0.4.0" } },
      launcher: { name: "mulmoclaude", dependencies: { "gui-chat-protocol": "0.4.0" } },
    });
    try {
      const findings = await sync.auditLauncherSync({ root });
      assert.deepEqual(findings, []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("flags when root and launcher diverge on the same dep", async () => {
    const root = makeFakeRepo({
      root: { name: "monorepo", dependencies: { "gui-chat-protocol": "0.4.0" } },
      launcher: { name: "mulmoclaude", dependencies: { "gui-chat-protocol": "^0.3.0" } },
    });
    try {
      const findings = await sync.auditLauncherSync({ root });
      const mismatches = findings.filter((finding) => finding.kind === "root-launcher-mismatch");
      assert.equal(mismatches.length, 1);
      assert.match(mismatches[0].message, /gui-chat-protocol.*root=0\.4\.0.*launcher=\^0\.3\.0/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("auditLauncherSync — invariant 2: workspace source vs launcher range", () => {
  it("passes when the workspace source satisfies the launcher range", async () => {
    const root = makeFakeRepo({
      root: { name: "monorepo", dependencies: {} },
      launcher: { name: "mulmoclaude", dependencies: { "@mulmoclaude/form-plugin": "^0.1.4" } },
      workspaces: [{ dir: "packages/plugins/form-plugin", pkg: { name: "@mulmoclaude/form-plugin", version: "0.1.4" } }],
    });
    try {
      const findings = await sync.auditLauncherSync({ root });
      assert.deepEqual(findings, []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("flags when the workspace source is behind the launcher range's lower bound", async () => {
    const root = makeFakeRepo({
      root: { name: "monorepo", dependencies: {} },
      launcher: { name: "mulmoclaude", dependencies: { "@mulmoclaude/form-plugin": "^0.2.0" } },
      workspaces: [{ dir: "packages/plugins/form-plugin", pkg: { name: "@mulmoclaude/form-plugin", version: "0.1.4" } }],
    });
    try {
      const findings = await sync.auditLauncherSync({ root });
      const drifts = findings.filter((finding) => finding.kind === "workspace-source-drift");
      assert.equal(drifts.length, 1);
      assert.match(drifts[0].message, /form-plugin.*0\.1\.4.*\^0\.2\.0/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("auditLauncherSync — invariant 3: plugin peer dep vs launcher pin (#1920 anti-regression)", () => {
  it("flags a bundled plugin whose peer dep does NOT satisfy the launcher pin", async () => {
    const root = makeFakeRepo({
      root: { name: "monorepo", dependencies: {} },
      launcher: {
        name: "mulmoclaude",
        dependencies: {
          "@mulmoclaude/form-plugin": "^0.1.3",
          "gui-chat-protocol": "0.4.0",
        },
      },
      workspaces: [
        {
          dir: "packages/plugins/form-plugin",
          pkg: { name: "@mulmoclaude/form-plugin", version: "0.1.3", peerDependencies: { "gui-chat-protocol": "^0.3.0" } },
        },
      ],
    });
    try {
      const findings = await sync.auditLauncherSync({ root });
      const violations = findings.filter((finding) => finding.kind === "peer-dep-violation");
      assert.equal(violations.length, 1);
      assert.match(violations[0].message, /form-plugin.*gui-chat-protocol.*\^0\.3\.0.*0\.4\.0/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("passes when the plugin peer dep is compatible with the launcher pin", async () => {
    const root = makeFakeRepo({
      root: { name: "monorepo", dependencies: {} },
      launcher: {
        name: "mulmoclaude",
        dependencies: {
          "@mulmoclaude/form-plugin": "^0.1.4",
          "gui-chat-protocol": "0.4.0",
        },
      },
      workspaces: [
        {
          dir: "packages/plugins/form-plugin",
          pkg: { name: "@mulmoclaude/form-plugin", version: "0.1.4", peerDependencies: { "gui-chat-protocol": "^0.4.0" } },
        },
      ],
    });
    try {
      const findings = await sync.auditLauncherSync({ root });
      assert.deepEqual(findings, []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not check peer deps for non-plugin workspace deps", async () => {
    const root = makeFakeRepo({
      root: { name: "monorepo", dependencies: {} },
      launcher: {
        name: "mulmoclaude",
        dependencies: { "@mulmoclaude/core": "^0.5.1", "gui-chat-protocol": "0.4.0" },
      },
      workspaces: [
        {
          dir: "packages/core",
          pkg: { name: "@mulmoclaude/core", version: "0.5.1", peerDependencies: { "gui-chat-protocol": "^0.3.0" } },
        },
      ],
    });
    try {
      const findings = await sync.auditLauncherSync({ root });
      const violations = findings.filter((finding) => finding.kind === "peer-dep-violation");
      assert.equal(violations.length, 0, "core is not a bundled plugin; its peer dep should not fail the gate");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("auditLauncherSync — repo self-check", () => {
  it("finds no failing findings against the real repo (post PR #1921)", async () => {
    const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
    const findings = await sync.auditLauncherSync({ root: repoRoot });
    const failing = findings.filter((finding) => finding.kind !== "skipped");
    const rendered = failing.map((finding) => `  [${finding.kind}] ${finding.message}`).join("\n");
    assert.deepEqual(failing, [], `Real repo has failing findings — root ↔ launcher out of sync:\n${rendered}`);
  });
});
