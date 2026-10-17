import type { Page } from "@playwright/test";
import { test, expect, gotoApp } from "./fixtures";

// Nothing may end up hidden under the fixed bottom nav. Scrolled to the very
// bottom, the last visible thing on the page (on object pages, often the
// altitude chart's legend or the AI section) must sit fully above the bar.
// Found at 375 px on 18 Oct: the chart legend sat under the nav.

test.skip(({ isMobile }) => !isMobile, "the bottom bar is a side rail on desktop");

const PAGES = [
  { name: "M42", hash: "#/detail/dso-M42", ready: ".alt-legend" },
  { name: "M82 (never rises)", hash: "#/detail/dso-M82", ready: ".alt-legend" },
  { name: "Sirius", hash: "#/detail/star-sirius", ready: ".alt-legend" },
  { name: "Jupiter", hash: "#/detail/planet-jupiter", ready: ".alt-legend" },
  { name: "Moon", hash: "#/detail/moon", ready: ".alt-legend" },
  { name: "Tonight", hash: "#/", ready: ".best-row:not(.skeleton)" },
  { name: "About", hash: "#/about", ready: ".about-version" },
];

/** Scroll to the bottom once the page stops growing; return the gap (px)
 *  between the lowest visible element in #app and the top of the nav. */
async function gapAboveNav(page: Page): Promise<{ gap: number; who: string }> {
  let last = -1;
  for (let i = 0; i < 20; i++) {
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    if (h === last) break;
    last = h;
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(250);
  }
  return page.evaluate(() => {
    const nav = document.querySelector(".nav")!.getBoundingClientRect();
    let bottom = -Infinity;
    let who = "";
    for (const el of document.querySelectorAll("#app *")) {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || st.visibility === "hidden" || st.display === "none") continue;
      // Content of a closed <details> keeps a layout box but is not painted.
      const closed = el.closest("details:not([open])");
      if (closed && !el.closest("summary")) continue;
      if (r.bottom > bottom) {
        bottom = r.bottom;
        who = `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`;
      }
    }
    return { gap: nav.top - bottom, who };
  });
}

for (const p of PAGES) {
  test(`${p.name}: the last element clears the bottom nav`, async ({ page }) => {
    await gotoApp(page, p.hash);
    await expect(page.locator(p.ready).first()).toBeVisible();
    const { gap, who } = await gapAboveNav(page);
    expect(gap, `${who} is ${-gap}px under the nav`).toBeGreaterThanOrEqual(8);
  });
}

test("the chart legend clears the nav when scrolled to it", async ({ page }) => {
  await gotoApp(page, "#/detail/dso-M42");
  const legend = page.locator(".alt-legend");
  await expect(legend).toBeVisible();
  await legend.scrollIntoViewIfNeeded();
  const [l, n] = await Promise.all([
    legend.evaluate((e) => e.getBoundingClientRect().bottom),
    page.locator(".nav").evaluate((e) => e.getBoundingClientRect().top),
  ]);
  expect(l).toBeLessThanOrEqual(n);
});

test("a taller nav (iPhone home bar, large text) still leaves the page clear", async ({ page }) => {
  await gotoApp(page, "#/detail/dso-M42");
  await expect(page.locator(".alt-legend")).toBeVisible();
  // Same effect as a 34 px home-indicator inset plus larger system text.
  await page.addStyleTag({ content: ".nav { padding-bottom: 34px !important; } .nav a { font-size: 0.8rem !important; min-height: 56px !important; }" });
  await page.waitForTimeout(200);
  const navH = await page.locator(".nav").evaluate((e) => e.getBoundingClientRect().height);
  expect(navH).toBeGreaterThan(85);
  const { gap, who } = await gapAboveNav(page);
  expect(gap, `${who} is ${-gap}px under the nav`).toBeGreaterThanOrEqual(8);
});
