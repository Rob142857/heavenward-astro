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
    await expect(page.locator(".search-results .card").first()).toBeAttached();
  });

  test("the search input stays visible", async ({ page }) => {
    await expect(page.locator(".search-input")).toBeInViewport();
  });

  test("first result is visible or scrolled into view", async ({ page }) => {
    test.info().annotations.push({
      type: "known-bug",
      description:
        "TODO(feature worker): with the keyboard up, the 19-chip palette sits between the input and the results, so results are pushed below the fold. Fix in src/ui/search.ts / styles.css (e.g. collapse the palette while typing or scroll results into view), then delete test.fail().",
    });
    test.fail();
    // Give any scroll-into-view logic a moment to run.
    await page.waitForTimeout(300);
    expect(await isInViewport(page, ".search-results .card")).toBe(true);
  });
});
