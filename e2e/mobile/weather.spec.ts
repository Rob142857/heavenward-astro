import type { Page } from "@playwright/test";
import { test, expect, gotoApp, horizontalOverflow } from "./fixtures";

// "Is it clear?": the cloud forecast from /api/weather. The route is always
// mocked here (no live network). Frozen clock 20:30 AEDT, 18 Oct 2026, at the
// invented NSW location (-31.4, 147.9).

const rows = ".best-list .best-row:not(.skeleton)";
const HOUR = 3_600_000;
const T0 = Date.parse("2026-10-18T00:00:00Z");

/** 48 hours from 00:00 UTC 18 Oct: clear early evening, low cloud building after midnight. */
function mockForecast() {
  const n = 48;
  const t = Array.from({ length: n }, (_, i) => T0 + i * HOUR);
  // 09:00Z = 20:00 AEDT. Low cloud from 14:00Z (01:00 AEDT).
  const low = t.map((_, i) => (i >= 14 && i <= 20 ? 70 : 5));
  const mid = t.map(() => 10);
  const high = t.map((_, i) => (i >= 10 && i <= 12 ? 40 : 15));
  const total = t.map((_, i) => Math.min(100, low[i] + Math.round(high[i] / 2)));
  const vis = t.map((_, i) => (i === 16 ? 6200 : 24100));
  return {
    ok: true,
    data: { cell: { lat: -31.4, lon: 147.9 }, fetchedAt: Date.parse("2026-10-18T09:05:00Z"), t, low, mid, high, total, vis },
    attribution: "Weather data by Open-Meteo.com (CC BY 4.0)",
  };
}

/** Records every /api/weather query and answers with `respond`. */
async function mockWeather(
  page: Page,
  respond: { status: number; body: unknown } | "abort",
): Promise<URL[]> {
  const seen: URL[] = [];
  await page.route("**/api/weather?*", async (route) => {
    seen.push(new URL(route.request().url()));
    if (respond === "abort") return route.abort("failed");
    return route.fulfill({
      status: respond.status,
      contentType: "application/json",
      body: JSON.stringify(respond.body),
    });
  });
  return seen;
}

/** Browsers log a failed fetch as a console error; that one is expected here. */
const realErrors = (errors: string[]) =>
  errors.filter((e) => !/Failed to load resource|status of 50\d|ERR_FAILED|api\/weather/i.test(e));

test("Tonight shows 'Is it clear?' with hourly low, mid and high cloud from the forecast", async ({ page, consoleErrors }, testInfo) => {
  const seen = await mockWeather(page, { status: 200, body: mockForecast() });
  await gotoApp(page, "#/");
  const block = page.locator(".cloud-block");
  await expect(block).toBeVisible();
  await expect(block.locator(".cloud-title")).toHaveText("Is it clear?");
  await expect(block.locator(".cloud-verdict")).toHaveText(/clear|cloudy/i);
  await expect(block.locator(".cloud-summary")).toContainText(/\d+% cloud on average from .+ to .+\./);
  await expect(block.locator(".cloud-summary")).toContainText("Visibility down to 6.2 km.");
  // High, mid and low rows, one column per dark hour (about 9 tonight).
  await expect(block.locator("tbody tr")).toHaveCount(3);
  await expect(block.locator("tbody th")).toHaveText(["High", "Mid", "Low"]);
  const hours = await block.locator("thead th").count();
  expect(hours - 1).toBeGreaterThanOrEqual(7);
  expect(hours - 1).toBeLessThanOrEqual(11);
  await expect(block.locator("tbody tr").last().locator("td").last()).toHaveText("70");
  // Attribution, linked.
  await expect(block.locator(".cloud-credit")).toContainText("Weather data by Open-Meteo.com (CC BY 4.0)");
  await expect(block.locator(".cloud-credit a")).toHaveAttribute("href", "https://open-meteo.com/");
  // Every row's why line now carries the cloud term.
  await expect(page.locator(rows).first()).toBeVisible();
  const whys = await page.locator(`${rows} .best-why`).allTextContents();
  expect(whys.length).toBeGreaterThan(5);
  for (const w of whys) expect(w).toMatch(/\d+% cloud forecast/);
  // Only the 0.1° cell went over the wire.
  expect(seen.length).toBeGreaterThan(0);
  for (const u of seen) {
    expect(u.searchParams.get("lat")).toMatch(/^-?\d+\.\d$/);
    expect(u.searchParams.get("lon")).toMatch(/^-?\d+\.\d$/);
  }
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  expect(consoleErrors).toEqual([]);
  if (process.env.HW_SHOTS && testInfo.project.name === "pixel-7") {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${process.env.HW_SHOTS}/heavenward-v4-tonight-cloud.png` });
  }
});

for (const failure of [
  { name: "502", respond: { status: 502, body: { ok: false, error: "forecast unavailable" } } },
  { name: "a network error", respond: "abort" as const },
]) {
  test(`with /api/weather failing (${failure.name}) Tonight renders the list with no error`, async ({ page, consoleErrors }, testInfo) => {
    await mockWeather(page, failure.respond);
    await gotoApp(page, "#/");
    await expect(page.locator(rows).first()).toBeVisible();
    expect(await page.locator(rows).count()).toBeGreaterThanOrEqual(5);
    await expect(page.locator(".cloud-block")).toBeHidden();
    await expect(page.locator(".best-status")).toBeEmpty();
    const whys = await page.locator(`${rows} .best-why`).allTextContents();
    for (const w of whys) expect(w).not.toMatch(/cloud/);
    expect(realErrors(consoleErrors)).toEqual([]);
    if (process.env.HW_SHOTS && testInfo.project.name === "pixel-7" && failure.name === "502") {
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `${process.env.HW_SHOTS}/heavenward-v4-tonight-weather-failing.png` });
    }
  });
}

test("the object page's altitude chart shades forecast cloud and credits Open-Meteo", async ({ page, consoleErrors }) => {
  await mockWeather(page, { status: 200, body: mockForecast() });
  await gotoApp(page, "#/detail/dso-M42");
  const chart = page.locator(".alt-chart");
  await expect(chart.locator(".alt-cloud").first()).toBeAttached();
  expect(await chart.locator(".alt-cloud").count()).toBeGreaterThanOrEqual(6);
  await expect(chart.locator(".alt-legend")).toContainText("Cloud forecast");
  await expect(chart.locator(".alt-cloud-credit")).toContainText("Weather data by Open-Meteo.com");
  expect(consoleErrors).toEqual([]);
});

test("without a forecast the chart has no cloud shading", async ({ page }) => {
  await gotoApp(page, "#/detail/dso-M42");
  await expect(page.locator(".alt-chart .alt-curve")).toBeAttached();
  await expect(page.locator(".alt-chart .alt-cloud")).toHaveCount(0);
  await expect(page.locator(".alt-chart .alt-cloud-credit")).toBeHidden();
});

test("About credits Open-Meteo", async ({ page }) => {
  await gotoApp(page, "#/about");
  const card = page.locator(".about-provenance .about-feature", { hasText: "Cloud Forecast" });
  await expect(card).toBeVisible();
  await expect(card.locator("a").first()).toHaveAttribute("href", "https://open-meteo.com/");
  await expect(page.locator(".about-section", { hasText: "Privacy" })).toContainText("Open-Meteo");
});
