import { test, expect, gotoApp } from "./fixtures";

// v-next 1 search acceptance: IDs with spaces, aliases, planets first, and
// search/object links. Ranking itself is unit-tested in
// test/search-core.test.ts; these check the page wiring.

const FIRST: [string, RegExp][] = [
  ["m 42", /Orion Nebula/],
  ["ngc 292", /Small Magellanic Cloud/],
  ["c80", /Omega Centauri/],
  ["lmc", /Large Magellanic Cloud/],
  ["tarantula", /Tarantula Nebula/],
  ["alpha centauri", /Rigil Kentaurus/],
  ["jupiter", /^Jupiter$/],
  ["pleiades", /^Pleiades$/],
];

test.describe("search finds the right first result", () => {
  for (const [q, name] of FIRST) {
    test(q, async ({ page }) => {
      await gotoApp(page, "#/search");
      await page.locator(".search-input").fill(q);
      // The first search builds the index from both catalogues: allow for a
      // slow first load when four workers share the machine.
      await expect(page.locator(".search-results .card .card-title").first()).toHaveText(name, {
        timeout: 15_000,
      });
    });
  }

  test("orion lists at least 10 objects including Rigel and M43", async ({ page }) => {
    await gotoApp(page, "#/search");
    await page.locator(".search-input").fill("orion");
    const titles = page.locator(".search-results .card .card-title");
    await expect(titles.first()).toBeVisible({ timeout: 15_000 });
    expect(await titles.count()).toBeGreaterThanOrEqual(10);
    const all = await titles.allTextContents();
    expect(all).toContain("Rigel");
    expect(all).toContain("Mairan's Nebula");
  });
});

test.describe("search and object links", () => {
  test("#/search?q=nebula opens search prefilled", async ({ page }) => {
    await gotoApp(page, "#/search?q=nebula");
    await expect(page.locator(".search-input")).toHaveValue("nebula");
    await expect(page.locator(".search-results .card").first()).toBeVisible();
  });

  test("typing keeps the query in the URL", async ({ page }) => {
    await gotoApp(page, "#/search");
    await page.locator(".search-input").fill("m 42");
    await expect(page).toHaveURL(/#\/search\?q=m\+42$/);
  });

  test("#/object/lmc opens the Large Magellanic Cloud page", async ({ page }) => {
    await gotoApp(page, "#/object/lmc");
    await expect(page.locator(".detail-title")).toHaveText("Large Magellanic Cloud");
  });

  test("#/object/ngc%20292 resolves a spaced catalogue ID", async ({ page }) => {
    await gotoApp(page, "#/object/ngc%20292");
    await expect(page.locator(".detail-title")).toHaveText("Small Magellanic Cloud");
  });

  test("an unknown object name falls back to search", async ({ page }) => {
    await gotoApp(page, "#/object/zzqx");
    await expect(page.locator(".search-input")).toHaveValue("zzqx");
  });
});
