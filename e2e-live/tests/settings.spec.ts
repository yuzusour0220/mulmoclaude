import { expect, test } from "@playwright/test";

import { ONE_MINUTE_MS } from "../../server/utils/time.ts";
import { isRecord } from "../../server/utils/types.ts";
import { placeWorkspaceFile, readWorkspaceFile, removeFromWorkspace } from "../fixtures/live-chat.ts";

const L_SETTINGS_EFFORT_TIMEOUT_MS = 2 * ONE_MINUTE_MS;

// `config/settings.json` is a single workspace-wide file shared by
// every chat session, so two specs mutating it concurrently would
// race the snapshot/restore dance below. Keep this describe serial,
// and fence any future settings-mutating spec the same way (the wiki
// `index.md` precedent in wiki-nav.spec.ts uses the same discipline).
test.describe.configure({ mode: "serial" });

const SETTINGS_REL = "config/settings.json";

// Pull `effortLevel` out of a raw settings.json blob. Returns
// `unknown` so the call site keeps full control over the expectation
// shape — `expect(value).toBe("low")` and `expect(value).toBeUndefined()`
// both work without an upstream cast.
function readEffortLevel(raw: string): unknown {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value)) {
    throw new Error(`settings.json is not a JSON object: ${raw.slice(0, 80)}`);
  }
  return value.effortLevel;
}

// Restore (or delete) the user's pre-test settings file. Best-effort
// so a cleanup hiccup never turns a passing assertion red — same
// philosophy as deleteSession / restoreWikiIndex.
async function restoreSettings(original: string | null): Promise<void> {
  try {
    if (original === null) {
      await removeFromWorkspace(SETTINGS_REL);
      return;
    }
    await placeWorkspaceFile(SETTINGS_REL, original);
  } catch (err) {
    console.warn(`restoreSettings: failed to restore ${SETTINGS_REL}`, err);
  }
}

test.describe("settings (real disk / static)", () => {
  test("L-SETTINGS-EFFORT — Model タブで effortLevel が settings.json と双方向に同期する", async ({ page }) => {
    test.setTimeout(L_SETTINGS_EFFORT_TIMEOUT_MS);
    // Covers PR #1332 / #1323 — the UI ↔ disk wire for `effortLevel`.
    // The buildCliArgs unit test (test/agent/test_agent_config.ts)
    // and the config-route integration test
    // (test/routes/test_configRoute.ts) already cover their seams,
    // but neither exercises the Vue ref two-way binding, the
    // @change auto-save, or the null-as-clear sentinel through a
    // real browser. A regression here is the class of bug those
    // unit tests cannot catch (e.g. the select silently desyncing
    // from `storedEffort.value` on race, or the cleared draft
    // omitting the null sentinel and leaking the previous value
    // through `{...existing, ...patch}`).
    //
    // We snapshot the real on-disk settings.json so the user's
    // production state round-trips through this test untouched.

    const original = await readWorkspaceFile(SETTINGS_REL);

    try {
      // ── Phase 1: seed disk → reload → UI reflects ──
      // Establishes the load path independently from the save path
      // tested in Phase 2. A hand-edit of settings.json with
      // `effortLevel: "max"` must surface as the active selection
      // when the Model tab mounts.
      await placeWorkspaceFile(SETTINGS_REL, `${JSON.stringify({ extraAllowedTools: [], effortLevel: "max" }, null, 2)}\n`);

      await page.goto("/");
      await page.getByTestId("settings-btn").click();
      await expect(page.getByTestId("settings-modal")).toBeVisible();
      await page.getByTestId("settings-tab-model").click();

      const select = page.getByTestId("settings-model-effort-select");
      await expect(select, "Model tab must reflect on-disk effortLevel=max on mount").toHaveValue("max");

      // ── Phase 2: change via UI to "low" → @change auto-save → file updated ──
      // The @change handler fires save(), which PUTs the patch and
      // — on resolve — flips `storedEffort.value` to the saved
      // value. The status strip is the user-visible "save landed"
      // signal; we wait on it so the subsequent file read does not
      // race the in-flight PUT (which would also race the server's
      // atomic write).
      await select.selectOption("low");
      await expect(page.getByTestId("settings-model-status"), "status strip must reflect the saved level").toContainText("low", { timeout: ONE_MINUTE_MS });

      const afterLow = await readWorkspaceFile(SETTINGS_REL);
      if (afterLow === null) {
        throw new Error(`settings.json went missing after auto-save (UI claimed success, server dropped the file?)`);
      }
      expect(readEffortLevel(afterLow), "effortLevel must be 'low' on disk after UI change").toBe("low");

      // ── Phase 3: clear via empty option → file key absent ──
      // The empty option sends `{ effortLevel: null }`; the route
      // handler honours the sentinel by `delete merged.effortLevel`
      // after the spread (see server/api/routes/config.ts). The
      // regression shape we close is the previous value leaking
      // through `{...existing, ...patch}` when the patch is normalised
      // to drop the null — that's why we assert key-absent, not just
      // "value not 'low'".
      await select.selectOption("");
      await expect(page.getByTestId("settings-model-status"), "status strip must flip away from the prior level after clear").not.toContainText("low", {
        timeout: ONE_MINUTE_MS,
      });

      const afterClear = await readWorkspaceFile(SETTINGS_REL);
      if (afterClear === null) {
        throw new Error(`settings.json went missing after clear (the file itself must survive — only the field is dropped)`);
      }
      expect(readEffortLevel(afterClear), "effortLevel key must be absent on disk after clear (null sentinel honoured)").toBeUndefined();
    } finally {
      await restoreSettings(original);
    }
  });
});
