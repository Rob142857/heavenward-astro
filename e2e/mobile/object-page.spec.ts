import { test, expect, gotoApp } from "./fixtures";

// Object pages: verdict row, the data fixes and the section order.
// Frozen clock: 20:30 AEDT, 18 Oct 2026, at -31.4, 147.9 (inland NSW).

function item(page: import("@playwright/test").Page, label: string) {
  return page.locator(".detail-item", { has: page.locator(".label", { hasText: new RegExp(`^${label}$`) }) });
}

test("M42: verdict row with equipment, best window and Moon, above the chart", async ({ page }) => {
  await gotoApp(page, "#/detail/dso-M42");
  const verdict = page.locator(".verdict-row");
  await expect(verdict).toContainText("Needs: Naked eye");
  await expect(verdict).toContainText(/Best \d\d:\d\d [ap]m–\d\d:\d\d [ap]m, peaks \d+° N/i);
  await expect(verdict).toContainText(/Moon \d+% lit, \d+° away|Moon down then/);
  const order = await page.evaluate(() => {
    const y = (s: string) => document.querySelector(s)!.getBoundingClientRect().top;
    return [y(".detail-title"), y(".verdict-row"), y(".alt-chart"), y(".object-image-wrap"), y(".detail-brief")];
  });
  expect([...order].sort((a, b) => a - b)).toEqual(order);
});

test("the verdict follows the chart's minimum altitude", async ({ page }) => {
  await gotoApp(page, "#/detail/dso-M42");
  const verdict = page.locator(".verdict-row");
  await expect(verdict).toContainText(/Best/);
  const at30 = await verdict.textContent();
  // M42 peaks at 65° just before dawn: 60° leaves a much shorter window.
  await page.locator(".alt-min-select").selectOption("60");
  await expect(verdict).not.toHaveText(at30!);
  await expect(verdict).toContainText(/Best|No good window tonight \(needs 60° in the dark\)/);
  await page.locator(".alt-min-select").selectOption("30");
  await expect(verdict).toHaveText(at30!);
});

test("M82 from NSW: never rises, and no best month", async ({ page }) => {
  await gotoApp(page, "#/detail/dso-M82");
  await expect(page.locator(".verdict-row")).toContainText("Never rises here");
  await expect(item(page, "Best month").locator(".value")).toHaveText("Never rises here");
});

test("M42 data: emission nebula, best month by latitude, no duplicate B magnitude", async ({ page }) => {
  await gotoApp(page, "#/detail/dso-M42");
  await expect(page.locator(".detail-catalog-id")).toContainText("Emission nebula (HII)");
  await expect(item(page, "Best month").locator(".value")).toHaveText("December (summer here)");
  await expect(item(page, "Best Season")).toHaveCount(0);
  // OpenNGC gives M42 V = B = 4.0; only one magnitude row is shown.
  await expect(item(page, "Magnitude \\(B\\)")).toHaveCount(0);
});

test("surface brightness is labelled in mag/arcsec²", async ({ page }) => {
  await gotoApp(page, "#/detail/dso-M31");
  await expect(page.locator(".detail-item .value", { hasText: "mag/arcsec²" })).toBeVisible();
  await expect(page.locator("text=mag/arcmin²")).toHaveCount(0);
});

test("long sections start folded; tapping one opens it", async ({ page }) => {
  await gotoApp(page, "#/detail/star-sirius");
  const folded = page.locator("details.detail-collapsible");
  await expect(folded.first()).toBeAttached({ timeout: 15_000 });
  const count = await folded.count();
  for (let i = 0; i < count; i++) await expect(folded.nth(i)).not.toHaveAttribute("open", "");
  const first = folded.first();
  await first.locator("summary").click();
  await expect(first).toHaveAttribute("open", "");
  await expect(first.locator(".detail-collapsible-body")).toBeVisible();
});

test("Jupiter: verdict says naked eye", async ({ page }) => {
  await gotoApp(page, "#/detail/planet-jupiter");
  await expect(page.locator(".verdict-row")).toContainText("Needs: Naked eye");
});
