import { test, expect, gotoApp } from "./fixtures";

const rows = ".best-list .best-row:not(.skeleton)";

test.describe("landmarks and names", () => {
  test("the app is one <main>, with a named nav and a level-1 heading", async ({ page }) => {
    await gotoApp(page, "#/");
    await expect(page.locator("main#app")).toHaveCount(1);
    await expect(page.locator("nav.nav")).toHaveAttribute("aria-label", /\S/);
    await expect(page.locator("[role=heading][aria-level='1']")).toHaveCount(1);
  });

  test("the current page is marked in the bottom nav", async ({ page }) => {
    await gotoApp(page, "#/");
    await expect(page.locator("nav.nav a[aria-current='page']")).toHaveCount(1);
    await expect(page.locator("nav.nav a.active")).toHaveAttribute("aria-current", "page");
  });

  test("the location button's name starts with its visible text", async ({ page }) => {
    await gotoApp(page, "#/");
    const pill = page.locator("button.location-pill");
    const visible = ((await pill.textContent()) ?? "").trim();
    expect(visible.length).toBeGreaterThan(0);
    expect(((await pill.getAttribute("aria-label")) ?? "").startsWith(visible)).toBe(true);
  });
});

test.describe("Tonight's Best rows", () => {
  test("each row is a list item holding a real link; no role on the <li>", async ({ page }) => {
    await gotoApp(page, "#/");
    const first = page.locator(rows).first();
    await expect(first).toBeVisible();
    await expect(page.locator(".best-list > li[role]:not(.skeleton)")).toHaveCount(0);
    const link = first.locator("a.best-link");
    await expect(link).toHaveAttribute("href", /^#\/detail\/.+/);
    // Name comes from the visible text, not an aria-label that could drift.
    await expect(link).not.toHaveAttribute("aria-label", /.*/);
  });

  test("a row opens by keyboard (Tab to the link, Enter)", async ({ page }) => {
    await gotoApp(page, "#/");
    const first = page.locator(rows).first();
    await expect(first).toBeVisible();
    const name = ((await first.locator(".best-name-text").textContent()) ?? "").trim();
    await first.locator("a.best-link").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".detail-title")).toHaveText(name);
  });
});
