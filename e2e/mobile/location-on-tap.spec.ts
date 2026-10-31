import { test, expect, gotoApp } from "./fixtures";

// Without a prior grant, the app must not call the GPS on load (no permission
// prompt); it shows "Set your location" and asks only after a tap.
test.describe("location is asked on tap, not on load", () => {
  test.use({ permissions: [] });

  test("no GPS call on load; the header invites a tap", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __gpsCalls: number }).__gpsCalls = 0;
      const geo = navigator.geolocation;
      const original = geo.getCurrentPosition.bind(geo);
      geo.getCurrentPosition = (...args: Parameters<Geolocation["getCurrentPosition"]>) => {
        (window as unknown as { __gpsCalls: number }).__gpsCalls += 1;
        return original(...args);
      };
    });
    await gotoApp(page, "#/");
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => (window as unknown as { __gpsCalls: number }).__gpsCalls)).toBe(0);
    await expect(page.locator(".location-pill.is-unconfirmed")).toBeVisible();
  });

  test("first open goes to the Location screen once, then not again", async ({ page }) => {
    await gotoApp(page, "#/");
    await expect(page).toHaveURL(/#\/location/, { timeout: 15_000 });
    await expect(page.locator(".location-intro")).toBeVisible();
    await gotoApp(page, "#/");
    await page.waitForTimeout(1500);
    await expect(page).not.toHaveURL(/#\/location/);
  });
});
