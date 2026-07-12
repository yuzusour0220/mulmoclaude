// E2E for the "queue while running" chat input (#2067).
//
// While a run is in flight the input is no longer locked: sends are
// queued as removable chips instead of dispatching, and merge back into
// the input for a final manual edit + send once the run finishes.
//
// Run state is driven purely by what `/api/sessions` reports for the
// displayed session (see useSessionDerived). We flip a mutable flag and
// push a `sessions`-channel pub/sub event to make the client re-fetch and
// observe the run finishing — the same path the real server uses.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";
import { SESSION_A, SESSION_B } from "../fixtures/sessions";
import { chatInput } from "../fixtures/chat";

const HANDSHAKE = { sid: "mock-sid", upgrades: [], pingInterval: 25000, pingTimeout: 20000, maxPayload: 1_000_000 };

test.describe("chat input buffer while running", () => {
  let running: boolean;
  let agentCalls: string[];
  let pushSessionsRefresh: (() => void) | null;

  test.beforeEach(async ({ page }) => {
    running = true;
    agentCalls = [];
    pushSessionsRefresh = null;

    await mockAllApis(page);

    // Stateful `/api/sessions` — registered after mockAllApis so it wins
    // (Playwright checks last-registered-first). SESSION_A's run state
    // tracks the `running` flag the test toggles.
    await page.route(
      (url) => url.pathname === "/api/sessions",
      (route) => {
        if (route.request().method() !== "GET") return route.fallback();
        return route.fulfill({
          json: { sessions: [{ ...SESSION_A, isRunning: running }, SESSION_B], cursor: "v1:0", deletedIds: [] },
        });
      },
    );

    // Sends while running must NOT hit the agent — track POSTs to prove it.
    await page.route(
      (url) => url.pathname === "/api/agent",
      (route) => {
        if (route.request().method() === "POST") {
          agentCalls.push(route.request().postData() ?? "");
          return route.fulfill({ status: 202, json: { chatSessionId: "mock-session" } });
        }
        return route.fallback();
      },
    );

    // Minimal socket.io mock: accept the handshake + subscriptions, and
    // expose a way to push a `sessions`-channel event that makes the
    // client re-read `/api/sessions` (how it learns the run finished).
    await page.routeWebSocket(
      (url) => url.pathname.startsWith("/ws/pubsub"),
      (webSocket) => {
        webSocket.send(`0${JSON.stringify(HANDSHAKE)}`);
        webSocket.onMessage((msg) => {
          const text = String(msg);
          if (text === "2") return webSocket.send("3");
          if (text === "40") return webSocket.send(`40${JSON.stringify({ sid: "mock-socket-sid" })}`);
        });
        pushSessionsRefresh = () => webSocket.send(`42${JSON.stringify(["data", { channel: "sessions", data: { updated: true } }])}`);
      },
    );

    await page.goto(`/chat/${SESSION_A.id}`);
    await expect(chatInput(page)).toBeVisible();
  });

  async function finishRun(page: Page): Promise<void> {
    running = false;
    // The socket connects a beat after navigation; retry the push until
    // the client has wired its `sessions` listener and re-fetches.
    await expect(async () => {
      pushSessionsRefresh?.();
      await expect(page.getByTestId("stop-btn")).toHaveCount(0, { timeout: 200 });
    }).toPass();
  }

  test("input stays editable and shows the stop button while running", async ({ page }) => {
    await expect(chatInput(page)).toBeEnabled();
    await expect(page.getByTestId("stop-btn")).toBeVisible();
    await expect(page.getByTestId("send-btn")).toHaveCount(0);
  });

  test("Enter queues messages as removable chips without dispatching", async ({ page }) => {
    const input = chatInput(page);

    await input.fill("first queued");
    await input.press("Enter");
    await expect(page.getByTestId("buffered-message")).toHaveCount(1);
    await expect(page.getByTestId("buffered-message").first()).toContainText("first queued");
    await expect(input).toHaveValue("");

    await input.fill("second queued");
    await input.press("Enter");
    await expect(page.getByTestId("buffered-message")).toHaveCount(2);

    // Nothing was sent to the agent while running.
    expect(agentCalls).toHaveLength(0);

    // Remove the first chip via its ✕ button.
    await page.getByTestId("buffered-message-remove").first().click();
    await expect(page.getByTestId("buffered-message")).toHaveCount(1);
    await expect(page.getByTestId("buffered-message").first()).toContainText("second queued");
  });

  test("queued messages merge back into the input when the run finishes", async ({ page }) => {
    const input = chatInput(page);

    await input.fill("one");
    await input.press("Enter");
    await input.fill("two");
    await input.press("Enter");
    await expect(page.getByTestId("buffered-message")).toHaveCount(2);

    await finishRun(page);

    // Chips cleared; both messages merged into the editable input,
    // oldest-first, newline separated.
    await expect(page.getByTestId("buffered-message")).toHaveCount(0);
    await expect(input).toHaveValue("one\ntwo");
    // Now idle: the send button is back for the final manual send.
    await expect(page.getByTestId("send-btn")).toBeVisible();
  });

  test("Ctrl+Enter inserts a newline instead of queuing", async ({ page }) => {
    const input = chatInput(page);
    await input.fill("hello");
    await input.press("Control+Enter");
    await expect(input).toHaveValue("hello\n");
    await expect(page.getByTestId("buffered-message")).toHaveCount(0);
    expect(agentCalls).toHaveLength(0);
  });
});
