import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { ONE_MINUTE_MS, ONE_SECOND_MS } from "../../server/utils/time.ts";
import {
  clearNotifierEntry,
  deleteSession,
  getCurrentSessionId,
  listNotifierEntries,
  sendChatMessage,
  startNewSession,
  waitForAssistantResponseComplete,
} from "../fixtures/live-chat.ts";

const L17_TIMEOUT_MS = 2 * ONE_MINUTE_MS;
// One agent turn (real LLM or fake-echo) + notifier-engine write +
// pubsub fan-out + composable refresh on the SPA side. fake-echo
// runs in milliseconds; real LLM is the bound. Generous enough for a
// loaded laptop without masking real flake.
const L17_BADGE_SETTLE_MS = 30 * ONE_SECOND_MS;
const L18_TIMEOUT_MS = 3 * ONE_MINUTE_MS;
const L19_TIMEOUT_MS = 2 * ONE_MINUTE_MS;
const L20_TIMEOUT_MS = ONE_MINUTE_MS;
// pluginPresentForm.* keys exist; the regression shape is one of
// them leaking into the rendered DOM when a translation lookup
// misses. Asserting "no `pluginPresentForm.` substring is visible
// inside the rendered form" catches that without coupling to any
// specific locale.
const PRESENT_FORM_RAW_KEY_PREFIX = "pluginPresentForm.";

// Each scenario is independent — L-19 spins up its own chat session,
// L-20 stays on a static route — so run them in parallel to cut wall
// time. Same justification as media.spec.ts / wiki-nav.spec.ts.
test.describe.configure({ mode: "parallel" });

// Compact representation of the session-history-toggle unread badge
// for the L-17 before/after comparison. Visibility alone isn't enough
// — a badge that goes from "2" to "3" would still be visible at both
// snapshots, so the spec also captures the displayed count. `text` is
// `null` when the badge is hidden (which is `unreadCount === 0` by
// the component's `v-if`).
interface UnreadBadgeSnapshot {
  visible: boolean;
  text: string | null;
}

async function snapshotUnreadBadge(badge: ReturnType<Page["getByTestId"]>): Promise<UnreadBadgeSnapshot> {
  const visible = await badge.isVisible();
  if (!visible) return { visible: false, text: null };
  const text = await badge.textContent();
  return { visible: true, text: text === null ? null : text.trim() };
}

test.describe("ui (real LLM / static)", () => {
  test("L-17: notify tool 経由の publish はベルだけを更新し session-history unread badge は変えない (B-50)", async ({ page }) => {
    test.setTimeout(L17_TIMEOUT_MS);
    // Covers B-50 ("二重通知"): PR #818
    // (`fix/skip-bell-on-bridge-completion`) commented out
    // `publishNotification()` in `runAgentInBackground`'s finally
    // block because bridge-origin agent completions already tick
    // the Session History side panel's unread badge via `endRun()`
    // flipping `session.hasUnread = true`. Two badges for one event
    // was the duplicate-notification user report.
    //
    // Canary strategy: drive a publish through the production code
    // path that real users hit (`notify` MCP tool → `publishNotification`
    // → `engine.publish` → pubsub fan-out → `useNotifications`
    // composable). Then assert (a) the bell row materialises (proves
    // the publish event made it end-to-end), and (b) the
    // `[session-history-unread-badge]` snapshot is unchanged (the
    // B-50 invariant: notifier publishes do NOT touch session
    // `hasUnread`).
    //
    // The prompt is shaped so both backends route to notify:
    //   - real LLM: Claude's tool dispatch will call the notify MCP
    //     tool when asked explicitly. We pin the title verbatim so
    //     it can't be paraphrased.
    //   - fake-echo: `detectNotify` matches the literal `title "..."`
    //     in the prompt and dispatches via `dispatchNotifyInProcess`
    //     (calls notify.handler directly, same engine path).
    // The nonce keeps parallel workers and previous runs isolated.
    const nonce = randomUUID().slice(0, 8);
    const title = `e2e-live-l17-${nonce}`;
    const userPrompt = `Use the notify tool with title "${title}". Do not include a body.`;

    await page.goto("/");
    const bell = page.getByTestId("notification-bell");
    await expect(bell, "notification-bell must mount on the top chrome").toBeVisible();

    // Capture the session-history unread-badge baseline BEFORE the
    // agent turn. The badge has `v-if="unreadCount > 0"`, so the
    // testid is absent at zero and present at ≥1. Compare both
    // visibility AND textContent so a stray count change (2 → 3 with
    // the badge already visible on both sides) still fails the
    // assertion.
    const unreadBadge = page.getByTestId("session-history-unread-badge");
    const unreadBefore = await snapshotUnreadBadge(unreadBadge);

    let chatSessionId: string | null = null;
    let publishedNotifierId: string | null = null;
    try {
      await startNewSession(page);
      await sendChatMessage(page, userPrompt);
      // Drain the assistant turn first so the notify tool call has
      // landed before we go looking for the bell row.
      await waitForAssistantResponseComplete(page);
      chatSessionId = getCurrentSessionId(page);

      // Find the entry the agent just published. We can't predict
      // its id (engine assigns a UUID), so list active entries and
      // match by the nonce-bearing title. Filtering by title
      // discounts background publishers (Encore obligations,
      // ghost-bell recovery) that the dev server might fire on its
      // own during the run.
      await expect
        .poll(
          async () => {
            const entries = await listNotifierEntries(page);
            return entries.find((entry) => entry.title === title) ?? null;
          },
          {
            timeout: L17_BADGE_SETTLE_MS,
            message: "the notify tool call must produce a notifier entry with the spec-pinned title",
          },
        )
        .not.toBeNull();
      const entries = await listNotifierEntries(page);
      const ours = entries.find((entry) => entry.title === title);
      if (!ours) throw new Error(`L-17: published entry vanished between poll and re-list (title=${title})`);
      publishedNotifierId = ours.id;

      // Open the bell panel and confirm the row is visible — proves
      // the pubsub fan-out reached `useNotifications` and the bell
      // mounted the row, not just that the disk record exists.
      await bell.click();
      await expect(page.getByTestId(`notification-item-${publishedNotifierId}`), "the published notifier row must mount in the bell panel").toBeVisible({
        timeout: L17_BADGE_SETTLE_MS,
      });
      await page.keyboard.press("Escape");

      // B-50 regression assertion. The notifier publish must not
      // have flipped any session's `hasUnread`. If a future refactor
      // accidentally couples the notifier publish path to
      // `session.hasUnread` (e.g. via a shared event channel), the
      // session-history badge would tick on every publish — exactly
      // the two-badges-for-one-event shape PR #818 fixed.
      const unreadAfter = await snapshotUnreadBadge(unreadBadge);
      expect(unreadAfter, "notify publish must not affect [session-history-unread-badge] — B-50 regression").toEqual(unreadBefore);
    } finally {
      // Cleanup order matters: clear the notifier entry FIRST so a
      // failed session delete doesn't leave a row on the bell, then
      // delete the chat session so it doesn't pollute the sidebar.
      if (publishedNotifierId !== null) {
        await clearNotifierEntry(page, publishedNotifierId).catch(() => {});
      }
      if (chatSessionId !== null) await deleteSession(page, chatSessionId);
    }
  });

  test("L-18: presentForm の i18n キーが raw 文字列として DOM に漏れない", async ({ page }) => {
    // fake-echo detects `presentForm` in the prompt + the `id='...'
    // label='...'` shape, posts to /api/form (the same endpoint the
    // MCP bridge uses for real Claude), and emits the result as the
    // tool_call_result. The View mounts off the artifact.
    test.setTimeout(L18_TIMEOUT_MS);
    // Covers B-34: when presentForm was promoted from external
    // plugin to built-in, the i18n keys (pluginPresentForm.submit
    // / .submitted / .progress / ...) were not migrated to the
    // shared dictionary, so the raw key strings rendered verbatim
    // in place of the translated copy. The fix (PR #845) wired
    // them up; the canary here is the absence of the raw-key
    // prefix anywhere inside the rendered presentForm view.
    //
    // Strategy: ask the agent to render a presentForm via the tool
    // (single text field, no validation) so the form mounts with
    // the static labels (submit button, progress counter) plus any
    // LLM-authored field copy. Whichever route the agent picks
    // (deferred ToolSearch + presentForm or direct call), the
    // resulting view is what users see, and that's the surface we
    // assert on.
    const userPrompt =
      "Use the presentForm tool to display a single-field form titled 'Quick check'. Add one required text field with id='nickname', label='Nickname', and a short description. No other fields. Do not submit it for me.";
    let sessionIdForCleanup: string | null = null;
    try {
      await startNewSession(page);
      await sendChatMessage(page, userPrompt);
      // Capture the session id BEFORE the form-mount assertion
      // (codex iter-1 leak fix): if presentForm never mounts the
      // assertion below times out, but the chat session was
      // already created the moment sendChatMessage's POST landed.
      // Waiting on the URL pattern is the same shape roles.spec.ts
      // uses for early capture and is bounded by the default nav
      // timeout (60s), so a stuck session creation surfaces as a
      // distinct waitForURL failure rather than leaking the
      // session into history.
      await page.waitForURL(/\/chat\/[0-9a-f-]+/);
      sessionIdForCleanup = getCurrentSessionId(page);

      // The form view is the tool-result render; mount-time is
      // bounded by a single LLM round-trip, so ONE_MINUTE_MS is
      // ample. We wait for it before the assistant turn fully
      // finishes — Claude often emits closing prose AFTER the
      // tool call lands, and that prose is not where B-34 hid.
      const formView = page.getByTestId("present-form-view");
      await expect(formView, "presentForm view must render after the tool call").toBeVisible({ timeout: ONE_MINUTE_MS });

      // B-34 canary — the i18n key prefix must not appear in the
      // rendered text. `not.toContainText` reads the visible text
      // of the matched element; raw `t("pluginPresentForm.submit")`
      // would spill the literal "pluginPresentForm.submit" here.
      await expect(formView, "presentForm DOM must not contain raw i18n keys (B-34 canary)").not.toContainText(PRESENT_FORM_RAW_KEY_PREFIX);

      // Drain the assistant turn so trace / video record the full
      // tool round-trip rather than cutting off mid-stream once
      // the assertion above lands.
      await waitForAssistantResponseComplete(page);
    } finally {
      if (sessionIdForCleanup !== null) await deleteSession(page, sessionIdForCleanup);
    }
  });

  test("L-19: stack layout で 1 ターン後 reload しても stack-scroll が再描画される", async ({ page }) => {
    // Any completed turn (real Claude or fake-echo) seeds the stack;
    // the assertion is on the reload-restore behavior, not on the
    // LLM's reasoning.
    test.setTimeout(L19_TIMEOUT_MS);
    // Covers B-31: tool-call history used to drop on reload because
    // the stack view's `toolResults` was rebuilt from the in-memory
    // turn stream rather than the persisted session record. The fix
    // hydrates from the session jsonl on mount, so reload should keep
    // `stack-scroll` mounted (and `stack-empty` hidden). A single-word
    // prompt is enough — even the assistant's textResponse reply
    // counts as a stack entry, so we don't need to coerce a tool
    // call to populate the panel.
    //
    // The default canvas layout is `single` (App.vue gates StackView
    // on `layoutMode === 'stack'`), so `stack-scroll` only mounts
    // after the user opts into stack mode. We seed the localStorage
    // key before the first navigation so both the initial render and
    // the post-reload render land in stack layout — that matches the
    // human-side reproduction path for B-31 (a stack-mode user notices
    // their turns disappearing on reload).
    const userPrompt = "Reply with the single word: stack";
    let sessionIdForCleanup: string | null = null;
    try {
      // addInitScript runs before every navigation (including reload),
      // so the stack preference survives the page.reload() below
      // without re-injecting after the second navigation.
      await page.addInitScript(() => {
        window.localStorage.setItem("canvas_layout_mode", "stack");
      });
      await startNewSession(page);
      await sendChatMessage(page, userPrompt);
      await waitForAssistantResponseComplete(page);
      sessionIdForCleanup = getCurrentSessionId(page);

      // Pre-reload: the assistant's reply must have at least one
      // entry in the stack (textResponse view). If this fails the
      // bug is upstream of B-31 (stack never populated in the first
      // place), so the assertion message stays distinct from the
      // post-reload one for diagnosability.
      await expect(page.getByTestId("stack-scroll"), "stack must be populated after the first turn (pre-reload)").toBeVisible();
      await expect(page.getByTestId("stack-empty"), "stack-empty must be hidden once a turn has landed").toBeHidden();

      await page.reload();

      // Post-reload: B-31's regression shape — the stack flips back
      // to the empty placeholder because hydration didn't refill
      // toolResults. Assert both the positive (stack still mounted)
      // and the negative (placeholder didn't reappear) so we catch
      // either side of the regression.
      await expect(page.getByTestId("stack-scroll"), "stack must rehydrate from the session record after reload — B-31 canary").toBeVisible();
      await expect(page.getByTestId("stack-empty"), "stack-empty must stay hidden after reload — B-31 canary").toBeHidden();
    } finally {
      if (sessionIdForCleanup !== null) await deleteSession(page, sessionIdForCleanup);
    }
  });

  test("L-20: 旧形式 /files?path=foo.md は新形式 /files/foo.md に書き換わる", async ({ page }) => {
    test.setTimeout(L20_TIMEOUT_MS);
    // Covers B-30 (URL-shape side): the legacy query-string form
    // `/files?path=…` must be silently rewritten to the new path
    // form `/files/…` by the router guard. Reload is a safety
    // net — the rewrite is `replace: true` so it should land in
    // history once and stay; we re-check after reload to make sure
    // the guard does not bounce the URL on every navigation.
    //
    // No file actually has to exist at the target path — we are
    // testing the router guard in isolation, not the file fetch.
    // `e2e-live-l20-nonexistent.md` is intentionally not seeded so
    // the cleanup story stays trivial (nothing to remove).
    const targetFile = "e2e-live-l20-nonexistent.md";
    await page.goto(`/files?path=${encodeURIComponent(targetFile)}`);
    await expect(page).toHaveURL(new RegExp(`/files/${targetFile}$`));
    await expect(page).not.toHaveURL(/\?path=/);

    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/files/${targetFile}$`));
    await expect(page).not.toHaveURL(/\?path=/);
  });
});
