import { test, expect, gotoApp } from "./fixtures";

// Per-device visual baselines. Clock, place and network are frozen by the
// fixtures, so the sky itself is stable; anything still volatile is masked.
// Refresh after an intended UI change: `pnpm test:mobile:update`.

const SHOTS: { name: string; hash: string; ready: string }[] = [
  { name: "tonight", hash: "#/", ready: ".card-grid .card:not(.skeleton)" },
  { name: "search", hash: "#/search", ready: ".search-palette" },
  { name: "about", hash: "#/about", ready: ".about-version" },
  { name: "star-detail", hash: "#/detail/star-sirius", ready: "header.header" },
];

for (const s of SHOTS) {
  test(`${s.name} matches baseline`, async ({ page }) => {
    await gotoApp(page, s.hash);
    await expect(page.locator(s.ready).first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`${s.name}.png`, {
      // Version/build line changes every commit; the finder chart canvas is
      // rendered with sub-pixel star glyphs that vary between GPUs.
      mask: [page.locator(".about-version"), page.locator("canvas"), page.locator(".seba-logo")],
    });
  });
}

test("search with results matches baseline", async ({ page }) => {
  await gotoApp(page, "#/search");
  await page.locator(".search-input").fill("orion");
  await expect(page.locator(".search-results .card").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveScreenshot("search-orion.png", {
    mask: [page.locator("canvas"), page.locator(".seba-logo")],
  });
});
