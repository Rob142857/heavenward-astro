import { test, expect, gotoApp, openVirtualKeyboard, isInViewport } from "./fixtures";

// The on-screen keyboard is approximated by shrinking the viewport to 55% of
// its height after the input has focus (see openVirtualKeyboard).

test.describe("search with the on-screen keyboard open", () => {
  test.skip(({ isMobile }) => !isMobile, "no on-screen keyboard on desktop");

  test.beforeEach(async ({ page }) => {
    await gotoApp(page, "#/search");
    const input = page.locator(".search-input");
    await input.tap();
    await expect(input).toBeFocused();
    await openVirtualKeyboard(page);
    await input.fill("sirius");
    // First search builds the index: allow for a slow load under 4 workers.
    await expect(page.locator(".search-results .card").first()).toBeAttached({ timeout: 15_000 });
  });

  test("the search input stays visible", async ({ page }) => {
    await expect(page.locator(".search-input")).toBeInViewport();
  });

  test("typing keeps focus (the field is not rebuilt per keystroke)", async ({ page }) => {
    await page.locator(".search-input").pressSequentially(" b");
    await expect(page.locator(".search-input")).toBeFocused();
    await expect(page.locator(".search-input")).toHaveValue("sirius b");
  });

  test("first result is visible or scrolled into view", async ({ page }) => {
    await page.waitForTimeout(300);
    expect(await isInViewport(page, ".search-results .card")).toBe(true);
  });
});

test.describe("search keyboard closes on intent", () => {
  test.skip(({ isMobile }) => !isMobile, "no on-screen keyboard on desktop");

  test("Enter blurs the input and the first result sits above a 300px keyboard", async ({ page }) => {
    await gotoApp(page, "#/search");
    const input = page.locator(".search-input");
    await input.tap();
    await input.fill("pleiades");
    await input.press("Enter");
    await expect(input).not.toBeFocused();
    const first = page.locator(".search-results .card").first();
    await expect(first).toContainText("Pleiades", { timeout: 15_000 });
    // Simulated 300px keyboard: the first result's top must be above it.
    const vp = page.viewportSize()!;
    await page.setViewportSize({ width: vp.width, height: vp.height - 300 });
    const top = await first.evaluate((el) => el.getBoundingClientRect().top);
    const visible = await page.evaluate(() => window.visualViewport?.height ?? window.innerHeight);
    expect(top).toBeLessThan(visible - 24);
  });

  test("tapping a chip does not raise the keyboard", async ({ page }) => {
    await gotoApp(page, "#/search");
    await page.locator(".search-chip-suggest[data-key='planet']").tap();
    await expect(page.locator(".search-results .card").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".search-input")).not.toBeFocused();
  });
});
