import { test, expect, gotoApp, horizontalOverflow, openEverything } from "./fixtures";

// Tonight's Best on the home page. Frozen clock: 20:30 AEDT, 18 Oct 2026, at
// the invented NSW location (-31.4, 147.9). The ranking rules themselves are
// unit-tested in test/tonight-best.test.ts; these check what the phone shows.

const rows = ".best-list .best-row:not(.skeleton)";

test("Tonight's Best lists at most 15 rows, each with window, peak, sparkline and why", async ({ page, consoleErrors }) => {
  await gotoApp(page, "#/");
  await expect(page.locator(rows).first()).toBeVisible();
  const n = await page.locator(rows).count();
  expect(n).toBeGreaterThanOrEqual(5);
  expect(n).toBeLessThanOrEqual(15);
  for (let i = 0; i < n; i++) {
    const row = page.locator(rows).nth(i);
    await expect(row.locator(".best-name-text")).not.toBeEmpty();
    await expect(row.locator(".best-type")).not.toBeEmpty();
    await expect(row.locator(".best-window")).toContainText(/\d:\d\d.*–.*\d:\d\d/);
    await expect(row.locator(".best-peak")).toContainText(/\d+° [NESW]{1,3}/);
    await expect(row.locator(".best-why")).not.toBeEmpty();
    await expect(row.locator("svg.best-spark .spark-curve")).toHaveAttribute("d", /^M[\d.]+,/);
  }
  // Planets and the Moon first.
  const pinned = await page.locator(`${rows}.pinned`).count();
  expect(pinned).toBeGreaterThan(0);
  const classes = await page.locator(rows).evaluateAll((els) => els.map((e) => e.classList.contains("pinned")));
  expect(classes.slice(0, pinned).every(Boolean)).toBe(true);
  expect(classes.slice(pinned).some(Boolean)).toBe(false);
  await expect(page.locator(".best-when")).toContainText(/Moon \d+% lit/);
  expect(consoleErrors).toEqual([]);
});

test("the full list sits behind 'Everything up now'", async ({ page }) => {
  await gotoApp(page, "#/");
  await expect(page.locator(rows).first()).toBeVisible();
  await expect(page.locator("details.everything")).not.toHaveAttribute("open", "");
  await expect(page.locator(".everything .card")).toHaveCount(0);
  await openEverything(page);
  await expect(page.locator(".everything .tonight-controls")).toBeVisible();
});

test("type chips filter the list and remember the choice", async ({ page }) => {
  await gotoApp(page, "#/");
  await expect(page.locator(rows).first()).toBeVisible();
  await page.locator(".best-chip[data-group='galaxies']").click();
  await expect(page.locator(".best-chip[data-group='galaxies']")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".best-chip[data-group='all']")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(rows).first()).toBeVisible();
  const types = await page.locator(`${rows} .best-type`).allTextContents();
  expect(types.length).toBeGreaterThan(0);
  for (const t of types) expect(t).toMatch(/galax/i);

  await page.reload();
  await expect(page.locator(".best-chip[data-group='galaxies']")).toHaveAttribute("aria-pressed", "true");
  await page.locator(".best-chip[data-group='all']").click();
  await expect(page.locator(".best-chip[data-group='all']")).toHaveAttribute("aria-pressed", "true");
});

test("equipment select changes the list; naked eye has the LMC, smart telescope shows faint targets", async ({ page }) => {
  await gotoApp(page, "#/");
  await expect(page.locator(rows).first()).toBeVisible();
  const select = page.locator(".best-eq-select");
  await expect(select).toHaveValue("binoculars");
  await select.selectOption("naked-eye");
  await expect(page.locator(rows, { hasText: "Large Magellanic Cloud" })).toBeVisible();
  const nakedNames = await page.locator(`${rows} .best-name-text`).allTextContents();
  await select.selectOption("smart-scope");
  await expect.poll(async () => (await page.locator(`${rows} .best-name-text`).allTextContents()).join("|")).not.toBe(nakedNames.join("|"));
});

test("tapping a row opens its object page", async ({ page }) => {
  await gotoApp(page, "#/");
  const first = page.locator(`${rows}:not(.pinned)`).first();
  await expect(first).toBeVisible();
  const name = (await first.locator(".best-name-text").textContent())!.trim();
  await first.click();
  await expect(page.locator(".detail-title")).toHaveText(name);
  await expect(page.locator(".verdict-row")).toContainText(/Best \d/);
});

test("no sideways scroll at 360 px", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone widths only");
  await page.setViewportSize({ width: 360, height: page.viewportSize()!.height });
  await gotoApp(page, "#/");
  await expect(page.locator(rows).first()).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test.describe("in the daytime", () => {
  test("at 2 pm Tonight's Best is tonight's plan, not a 'Sun is up' wall", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-18T03:00:00Z")); // 14:00 AEDT
    await gotoApp(page, "#/");
    await expect(page.locator(rows).first()).toBeVisible();
    await expect(page.locator(".best-when")).toContainText(/Dark from \d/);
    await expect(page.locator(".daylight-banner")).toHaveCount(0);
    // Windows are tonight's: every one starts after 7 pm.
    const windows = await page.locator(`${rows}:not(.pinned) .best-window`).allTextContents();
    expect(windows.length).toBeGreaterThan(0);
    for (const w of windows) expect(w).toMatch(/^(0[7-9]|1[0-2]):\d\d\s*pm|^\d\d:\d\d\s*am/i);
  });
});
