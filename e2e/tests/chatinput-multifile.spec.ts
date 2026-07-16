// E2E coverage for multi-file ChatInput attachment (#1666, follow-up to
// PR #1660). #1660 added multi-file attach but the Vue-component test infra
// wasn't in place, so the coverage was deferred. These drive the real app
// (attachment state lives in the App.vue parent, fed via `pastedFiles`), the
// same DataTransfer + DragEvent drop harness the sibling attach spec uses.
//
// Scenarios (from the issue):
//   1. Happy path — several supported files in one drop → a chip each.
//   2. 10-file cap — 11 files → tooManyFiles error, capped at 10 chips.
//   3. Failure recovery — a later drop containing an invalid file is
//      rejected WITHOUT wiping the already-attached chips (snapshot kept).
//   4. Race — two back-to-back drops both land (the fileQueue serialisation
//      in ChatInput keeps the second from clobbering the first).

import { test, expect } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

// The drop target is the wrapper two levels up from the textarea — same
// anchor the sibling chatinput-attach spec drops onto.
const dropTargetSelector = "[data-testid=user-input]";

test.describe("ChatInput multi-file attachment (#1666)", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllApis(page);
    await page.goto("/");
  });

  const chips = (page: import("@playwright/test").Page) => page.getByTestId("chat-attachment-preview");

  test("happy path: dropping several supported files at once shows a chip for each", async ({ page }) => {
    const dropTarget = page.locator(dropTargetSelector).locator("..").locator("..");
    await dropTarget.evaluate((element) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["a"], "a.png", { type: "image/png" }));
      transfer.items.add(new File(["b"], "b.txt", { type: "text/plain" }));
      transfer.items.add(new File(["c"], "c.pdf", { type: "application/pdf" }));
      element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    });
    await expect(chips(page)).toHaveCount(3);
    await expect(page.getByTestId("file-error")).toHaveCount(0);
  });

  test("10-file cap: dropping 11 files caps at 10 chips and surfaces the tooManyFiles error", async ({ page }) => {
    const dropTarget = page.locator(dropTargetSelector).locator("..").locator("..");
    await dropTarget.evaluate((element) => {
      const transfer = new DataTransfer();
      for (let i = 0; i < 11; i++) {
        transfer.items.add(new File([String(i)], `f${i}.txt`, { type: "text/plain" }));
      }
      element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    });
    // Capped at MAX_ATTACHMENTS (10), with the over-cap notice.
    await expect(chips(page)).toHaveCount(10);
    const banner = page.getByTestId("file-error");
    await expect(banner).toBeVisible();
    expect((await banner.textContent()) ?? "").toContain("10");
  });

  test("failure recovery: a later invalid drop does NOT wipe already-attached files", async ({ page }) => {
    const dropTarget = page.locator(dropTargetSelector).locator("..").locator("..");
    // First drop: two valid files → two chips.
    await dropTarget.evaluate((element) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["a"], "a.png", { type: "image/png" }));
      transfer.items.add(new File(["b"], "b.txt", { type: "text/plain" }));
      element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    });
    await expect(chips(page)).toHaveCount(2);

    // Second drop carrying an unsupported file: the batch is rejected and the
    // error surfaces, but the first two chips must remain (snapshot intact).
    await dropTarget.evaluate((element) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["z"], "bad.zip", { type: "application/zip" }));
      element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    });
    await expect(page.getByTestId("file-error")).toBeVisible();
    await expect(chips(page)).toHaveCount(2);
  });

  test("race: two back-to-back drops both attach (fileQueue serialisation)", async ({ page }) => {
    const dropTarget = page.locator(dropTargetSelector).locator("..").locator("..");
    // Fire two drops in the same tick without awaiting between them. If the
    // per-file processing weren't serialised through fileQueue, the second
    // emit (computed off a stale pastedFiles) could clobber the first.
    await dropTarget.evaluate((element) => {
      const dropOne = new DataTransfer();
      dropOne.items.add(new File(["1"], "one.txt", { type: "text/plain" }));
      const dropTwo = new DataTransfer();
      dropTwo.items.add(new File(["2"], "two.txt", { type: "text/plain" }));
      element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dropOne }));
      element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dropTwo }));
    });
    // Both files survive → two chips.
    await expect(chips(page)).toHaveCount(2);
  });
});
