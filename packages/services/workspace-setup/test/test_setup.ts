import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isPresetSlug, helpsAssetDir, presetSkillsAssetDir, seedHelps, syncPresetSkills } from "../src/index.ts";

test("isPresetSlug", () => {
  assert.equal(isPresetSlug("mc-library"), true);
  assert.equal(isPresetSlug("mc-"), false); // prefix only
  assert.equal(isPresetSlug("my-skill"), false);
});

test("bundled asset dirs exist and carry the preset skills", () => {
  assert.ok(existsSync(helpsAssetDir()), "helps asset dir exists");
  assert.ok(readdirSync(helpsAssetDir()).some((f) => f.endsWith(".md")), "helps has .md docs");
  assert.ok(existsSync(presetSkillsAssetDir()), "preset asset dir exists");
  const presets = readdirSync(presetSkillsAssetDir());
  assert.ok(
    presets.some((d) => d.startsWith("mc-")),
    "preset dir has mc-* skills",
  );
});

test("seedHelps copies the bundled help docs into a fresh workspace", () => {
  const ws = mkdtempSync(path.join(tmpdir(), "ws-setup-"));
  try {
    seedHelps({ destDir: path.join(ws, "helps") });
    const seeded = readdirSync(path.join(ws, "helps"));
    const source = readdirSync(helpsAssetDir());
    assert.deepEqual(seeded.sort(), source.sort());
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("syncPresetSkills copies the bundled presets into a catalog dir", () => {
  const ws = mkdtempSync(path.join(tmpdir(), "ws-setup-"));
  try {
    const dest = path.join(ws, "data", "skills", "catalog", "preset");
    const result = syncPresetSkills({ sourceDir: presetSkillsAssetDir(), destDir: dest });
    assert.ok(result.copied.length > 0, "copied at least one preset");
    assert.ok(result.copied.every(isPresetSlug), "every copied slug is mc-*");
    // Each copied preset has its SKILL.md at the destination.
    for (const slug of result.copied) {
      assert.ok(existsSync(path.join(dest, slug, "SKILL.md")), `${slug}/SKILL.md present`);
      assert.ok(readFileSync(path.join(dest, slug, "SKILL.md"), "utf8").length > 0);
    }
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
