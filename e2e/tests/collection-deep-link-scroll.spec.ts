// E2E coverage for the `?selected=<id>` deep link (the path a
// collection-item notification takes): opening a collection with a
// selected id that loaded far down a long list must not only expand
// that row's detail panel — it must SCROLL it into view. Before the
// fix, `syncViewToSelected` opened the record but never called
// `scrollOpenPanelIntoView`, so a notification for an off-screen item
// left the user staring at the top of the table.

import { test, expect, type Page } from "@playwright/test";
import { mockAllApis } from "../fixtures/api";

// Enough rows that an id near the bottom renders well below the fold on
// the default 720px-tall viewport — so "in viewport" is only true if we
// actually scrolled to it.
const ITEM_COUNT = 60;
const TARGET_ID = "item-55";

const LONG_LIST = {
  collection: {
    slug: "long-list",
    title: "Long List",
    icon: "list",
    source: "user",
    schema: {
      title: "Long List",
      icon: "list",
      dataPath: "data/long-list/items",
      primaryKey: "id",
      fields: {
        id: { type: "string", label: "ID", primary: true, required: true },
        name: { type: "string", label: "Name" },
      },
    },
  },
  items: Array.from({ length: ITEM_COUNT }, (_, i) => ({ id: `item-${i}`, name: `Row ${i}` })),
};

async function mockCollection(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/collections/long-list",
    (route) => route.fulfill({ json: LONG_LIST }),
  );
}

test("a `?selected=` deep link scrolls the opened record into view", async ({ page }) => {
  await mockAllApis(page);
  await mockCollection(page);

  await page.goto(`/collections/long-list?selected=${TARGET_ID}`);

  // The targeted record's detail panel expands inline under its row...
  const panel = page.getByTestId(`collections-expansion-${TARGET_ID}`);
  await expect(panel).toBeVisible({ timeout: 10_000 });

  // ...and — the regression this guards — it is scrolled into view, not
  // left below the fold. `toBeInViewport` auto-retries, so it waits out
  // the smooth scroll.
  await expect(panel).toBeInViewport();
});
