import { type Page, expect, test } from "@playwright/test";

import { ONE_MINUTE_MS } from "../../server/utils/time.ts";
import { deleteSession, getCurrentSessionId, selectRole, sendChatMessage, startNewSession, waitForAssistantResponseComplete } from "../fixtures/live-chat.ts";

const ROLE_TURN_TIMEOUT_MS = 2 * ONE_MINUTE_MS;
// "single word: hello" intentionally stays a no-tool-call prompt so
// every role variant pays the same flat agent round-trip — no MCP
// fan-out, no image gen, no spreadsheet build. The turn is purely a
// canary for B-41 (deferred-tools switch had broken every role's
// first-turn dispatch) and the role-selector wiring (B-15 used to
// keep input disabled on roles that needed Gemini).
const SINGLE_WORD_PROMPT = "Reply with the single word: hello";

test.describe.configure({ mode: "parallel" });

test.describe("roles (real LLM)", () => {
  test.skip(process.env.E2E_LIVE_NO_LLM === "1", "E2E_LIVE_NO_LLM=1 — Claude-dependent suite");

  test("L-06: General ロールで 1 ターン → 入力欄 enabled + 応答完走", async ({ page }) => {
    test.setTimeout(ROLE_TURN_TIMEOUT_MS);
    // Covers B-15 (General used to be disabled when GEMINI_API_KEY
    // was missing) and B-41 (deferred-tools switch broke role tool
    // calls). General is the default, so unlike L-07/08/09 we do not
    // call selectRole — startNewSession lands us here directly and
    // we assert that as the B-15 canary.
    let sessionIdForCleanup: string | null = null;
    try {
      await startNewSession(page);
      // The visible role label is localized in eight UI dictionaries
      // (CLAUDE.md keeps them in lockstep), so we assert on the
      // chip's `data-role` attribute instead — that's the locale-
      // agnostic identity of the active role and is the actual B-15
      // regression net (the bug disabled the General role
      // specifically).
      await expect(page.getByTestId("role-selector-btn"), "default role must be General — B-15 canary").toHaveAttribute("data-role", "general");
      await expect(page.getByTestId("user-input"), "input must be enabled — B-15 used to disable it on this role").toBeEnabled();
      await sendChatMessage(page, SINGLE_WORD_PROMPT);
      await waitForAssistantResponseComplete(page);
      // The empty-session placeholder lingers in DOM longer than the
      // thinking-indicator on chromium even after the reply lands, so
      // assert the durable signal instead: a chat session URL got
      // assigned. /chat/<id> means the turn made it past the deferred-
      // tools switch and produced a session record.
      const sessionId = getCurrentSessionId(page);
      expect(sessionId, "session id should be present after a successful turn (B-41 canary)").not.toBeNull();
      sessionIdForCleanup = sessionId;
    } finally {
      if (sessionIdForCleanup !== null) await deleteSession(page, sessionIdForCleanup);
    }
  });

  test("L-07: Office ロールで 1 ターン → 応答完走", async ({ page }) => {
    test.setTimeout(ROLE_TURN_TIMEOUT_MS);
    await runRoleSampleTurn(page, "office");
  });

  test("L-08: Tutor ロールで 1 ターン → 応答完走", async ({ page }) => {
    test.setTimeout(ROLE_TURN_TIMEOUT_MS);
    await runRoleSampleTurn(page, "tutor");
  });

  test("L-09: Storyteller ロールで 1 ターン → 応答完走", async ({ page }) => {
    test.setTimeout(ROLE_TURN_TIMEOUT_MS);
    await runRoleSampleTurn(page, "storyteller");
  });
});

const SESSION_URL_PATTERN = /\/chat\/[0-9a-f-]+/;

/**
 * Shared B-41 canary for non-default roles. Switches into `roleId`
 * (App.vue's onRoleChange spins up a fresh session in that role on
 * chat pages — see useCurrentRole + createNewSession), runs one
 * tool-free turn, and asserts the session id stuck.
 *
 * Cleanup deletes BOTH the auto-created General session and the
 * role-switched session. Earlier versions only deleted the latter,
 * which leaked one empty General session per L-07/L-08/L-09 run —
 * harmless per-run but unbounded across CI cycles. deleteSession is
 * best-effort + idempotent so the loop is safe even if one delete
 * misses (e.g., sidebar race).
 */
async function runRoleSampleTurn(page: Page, roleId: string): Promise<void> {
  const sessionsToCleanup: string[] = [];
  try {
    await startNewSession(page);
    await page.waitForURL(SESSION_URL_PATTERN);
    const generalSessionId = getCurrentSessionId(page);
    // The waitForURL above guarantees the URL matches /chat/<id>,
    // so getCurrentSessionId's regex capture cannot fail here.
    // Fail loud if it ever does so the diagnostic is "URL shape
    // changed" rather than "60s navigationTimeout" coming from the
    // ?? "" fallback below silently inverting the predicate
    // (CodeRabbit + Claude iter-1 convergence: endsWith("") is
    // always true, which would make the next waitForURL hang).
    if (generalSessionId === null) {
      throw new Error("getCurrentSessionId returned null after waitForURL(SESSION_URL_PATTERN) — startNewSession or URL pattern likely drifted");
    }
    sessionsToCleanup.push(generalSessionId);
    await selectRole(page, roleId);
    // Capture the role-switched session id as soon as the URL
    // settles on /chat/<id>, BEFORE the downstream assertions —
    // otherwise an early failure (role chip mismatch, disabled
    // input, send failure) would skip the capture and leak the
    // role session into history (Codex iter 2 question-level
    // catch). waitForURL forces a real navigation rather than
    // re-reading the General id.
    await page.waitForURL((url) => SESSION_URL_PATTERN.test(url.pathname) && !url.pathname.endsWith(generalSessionId));
    const roleSessionId = getCurrentSessionId(page);
    if (roleSessionId !== null && roleSessionId !== generalSessionId) {
      sessionsToCleanup.push(roleSessionId);
    }
    // Wait for the role chip to flip to the new id before driving
    // the input — the selection is async (App.vue spins up a new
    // session in the new role) and a too-eager send would land in
    // the old General session.
    await expect(page.getByTestId("role-selector-btn"), `role chip must reflect ${roleId} after switch (B-41 canary)`).toHaveAttribute("data-role", roleId);
    await expect(page.getByTestId("user-input"), "input must be enabled on this role").toBeEnabled();
    await sendChatMessage(page, SINGLE_WORD_PROMPT);
    await waitForAssistantResponseComplete(page);
    const sessionId = getCurrentSessionId(page);
    expect(sessionId, `session id should be present after a successful ${roleId} turn (B-41 canary)`).not.toBeNull();
    expect(sessionId, "post-turn session id should match the role-switched id captured earlier").toBe(roleSessionId);
  } finally {
    // Delete the General placeholder first, then the role-switched
    // session — keeps the page on a stable /chat/<id> while the
    // first delete walks the sidebar, and lets deleteSession's own
    // "step away from current /chat/<id>" branch handle the second.
    for (const sid of sessionsToCleanup) {
      await deleteSession(page, sid);
    }
  }
}
