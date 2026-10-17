import {
  test,
  expect,
  gotoApp,
  horizontalOverflow,
  openEverything,
  smallTapTargets,
} from "./fixtures";

const PAGES: { name: string; hash: string; ready: string }[] = [
  { name: "tonight", hash: "#/", ready: ".best-row:not(.skeleton)" },
  { name: "search", hash: "#/search", ready: ".search-input" },
  { name: "sources", hash: "#/sources", ready: "header.header" },
  { name: "location", hash: "#/location", ready: "header.header" },
  { name: "about", hash: "#/about", ready: "header.header" },
  { name: "account", hash: "#/account", ready: "header.header" },
  { name: "star detail", hash: "#/detail/star-sirius", ready: "header.header" },
];

test.describe("main pages", () => {
  for (const p of PAGES) {
    test(`${p.name} loads with no console errors`, async ({ page, consoleErrors }) => {
      await gotoApp(page, p.hash);
      await expect(page.locator(p.ready).first()).toBeVisible();
      // Let lazy chunks and catalog loads settle.
      await page.waitForLoadState("networkidle");
      expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
    });
  }
});

test.describe("no sideways scroll on narrow phones", () => {
  test.skip(({ isMobile }) => !isMobile, "phone widths only");

  for (const width of [360, 375]) {
    for (const p of PAGES) {
      test(`${p.name} at ${width}px`, async ({ page }) => {
        const vp = page.viewportSize()!;
        await page.setViewportSize({ width, height: vp.height });
        await gotoApp(page, p.hash);
        await expect(page.locator(p.ready).first()).toBeVisible();
        await page.waitForLoadState("networkidle");
        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      });
    }
  }
});

test.describe("no sideways scroll with search results", () => {
  test.skip(({ isMobile }) => !isMobile, "phone widths only");

  test("search results fit the screen width", async ({ page }) => {
    await gotoApp(page, "#/search");
    await page.locator(".search-input").fill("sirius");
    await expect(page.locator(".search-results .card").first()).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe("tap targets", () => {
  test.skip(({ isMobile }) => !isMobile, "touch layouts only");

  test("bottom nav and header controls are at least 44px", async ({ page }) => {
    await gotoApp(page, "#/");
    await expect(page.locator(".best-row:not(.skeleton)").first()).toBeVisible();
    const small = await smallTapTargets(
      page,
      "nav a, nav button, header button, header a",
    );
    expect(small, small.join("\n")).toEqual([]);
  });

  test("tonight filter controls are at least 44px", async ({ page }) => {
    await gotoApp(page, "#/");
    await openEverything(page);
    await expect(page.locator(".tonight-controls")).toBeVisible();
    // Open Filters so the equipment/category pills and selects are measured too.
    await page.locator(".filters-toggle").click();
    const small = await smallTapTargets(
      page,
      ".tonight-controls button, .tonight-controls select, .tonight-controls summary, .twilight-toggle",
    );
    expect(small, small.join("\n")).toEqual([]);
  });

  test("Tonight's Best chips, equipment select and rule toggle are at least 44px", async ({ page }) => {
    await gotoApp(page, "#/");
    await expect(page.locator(".best-row:not(.skeleton)").first()).toBeVisible();
    const small = await smallTapTargets(page, ".best-chip, .best-eq-select, .best-rule summary, .everything-toggle, .best-row");
    expect(small, small.join("\n")).toEqual([]);
  });

  test("search input and filter chips are at least 44px tall", async ({ page }) => {
    await gotoApp(page, "#/search?chips=galaxy");
    await expect(page.locator(".search-token-x")).toBeVisible();
    const small = await smallTapTargets(page, ".search-field, .search-chip-suggest, .search-token-x");
    expect(small, small.join("\n")).toEqual([]);
  });
});
