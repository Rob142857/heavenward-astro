import type { Page } from "@playwright/test";
import { test, expect, gotoApp } from "./fixtures";

/** "07:05 pm" / "19:05" -> minutes after midnight. */
function toMinutes(text: string): number {
  const m = text.match(/(\d{1,2}):(\d{2})\s*([ap]\.?m\.?)?/i);
  if (!m) throw new Error(`no time in "${text}"`);
  let h = Number(m[1]) % 12;
  if (!m[3]) h = Number(m[1]);
  else if (/p/i.test(m[3])) h += 12;
  return h * 60 + Number(m[2]);
}

async function sunsetMinutes(page: Page): Promise<number> {
  const quick = page.locator(".twilight-quick span").first();
  await expect(quick).toContainText(/\d:\d\d/);
  return toMinutes((await quick.textContent()) ?? "");
}

test.describe("geolocation", () => {
  test("first visit uses the device position", async ({ page }) => {
    await gotoApp(page, "#/");
    // Config geolocation is the invented point -31.40, 147.90.
    await expect(page.locator(".location-pill")).toHaveText("31.40°S, 147.90°E");
    await expect(page.locator(".location-pill")).not.toHaveClass(/is-unconfirmed/);
  });

  test.describe("when location is denied", () => {
    test.use({ permissions: [] });

    test("says the location is not set instead of showing Greenwich as yours", async ({ page, context }) => {
      await context.clearPermissions();
      await gotoApp(page, "#/");
      await expect(page.locator(".location-pill")).toHaveClass(/is-unconfirmed/, { timeout: 15_000 });
      await expect(page.locator(".location-pill")).toHaveText("Set your location");
    });
  });

  test("moving the device re-renders the sky for the new place on reload", async ({ page, context }) => {
    await context.setGeolocation({ latitude: 35.0, longitude: 139.0 });
    await page.addInitScript(() => localStorage.clear());
    await gotoApp(page, "#/");
    await expect(page.locator(".location-pill")).toHaveText("35.00°N, 139.00°E");
  });
});

test.describe("time zone", () => {
  test("twilight times follow the device clock (Sydney vs Perth)", async ({ browser, page }, testInfo) => {
    await gotoApp(page, "#/");
    const sydney = await sunsetMinutes(page);
    // October dusk in inland NSW lands between 6 and 8:30 pm AEDT.
    expect(sydney).toBeGreaterThanOrEqual(18 * 60);
    expect(sydney).toBeLessThanOrEqual(20 * 60 + 30);

    const perthCtx = await browser.newContext({
      ...testInfo.project.use,
      timezoneId: "Australia/Perth",
    });
    const perth = await perthCtx.newPage();
    await perth.clock.setFixedTime(new Date("2026-10-18T09:30:00Z"));
    await perth.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
    await gotoApp(perth, "#/");
    const perthSunset = await sunsetMinutes(perth);
    await perthCtx.close();
    // Same instant, same place: AEDT is UTC+11, AWST is UTC+8.
    expect(sydney - perthSunset).toBe(180);
  });

  test("deep link shows the place and its own clock", async ({ page }) => {
    await page.goto(
      "/?lat=-27.47&lng=153.03&date=2026-11-10&time=21:30&tz=Australia/Brisbane#/",
    );
    const bar = page.locator(".linked-sky-bar");
    await expect(bar).toBeVisible();
    await expect(bar).toContainText("-27.47, 153.03");
    await expect(bar).toContainText(/09:30\s*pm|21:30/i);
    // Params stay in the address bar so reload and share keep them.
    expect(page.url()).toContain("lat=-27.47");
  });

  test("deep link twilight times are on the link's clock, not the device's", async ({ page }) => {
    await page.goto(
      "/?lat=-27.47&lng=153.03&date=2026-11-10&time=21:30&tz=Australia/Brisbane#/",
    );
    await expect(page.locator(".linked-sky-bar")).toBeVisible();
    const sunset = await sunsetMinutes(page);
    // Brisbane sunset in November is about 6:15 pm AEST (no DST).
    expect(sunset).toBeLessThan(18 * 60 + 45);
  });
});

/** The value cell beside a detail-page label, e.g. "Altitude". */
function detailValue(page: Page, label: string) {
  return page
    .locator(".detail-item", { has: page.locator(".label", { hasText: new RegExp(`^${label}$`) }) })
    .first()
    .locator(".value");
}

async function altitudeOf(page: Page): Promise<number> {
  const value = detailValue(page, "Altitude");
  await expect(value).toContainText("°");
  return parseFloat((await value.textContent()) ?? "NaN");
}

test.describe("linked place and time on other pages", () => {
  const JUNE = "/?lat=-30.7&lng=152.98&date=2026-06-20&time=12:00&tz=Australia/Sydney#/detail/dso-M42";

  test("an object page uses the link's moment, keeps it on reload, and clears it", async ({ page }) => {
    await page.goto(JUNE);
    await expect(page.locator(".linked-sky-bar")).toContainText("-30.70, 152.98");
    // Noon on 20 June: M42 is about 64° up in daylight (frozen device clock
    // would give a different value). Reference in test/sky-time.test.ts.
    const june = await altitudeOf(page);
    expect(Math.abs(june - 63.7)).toBeLessThan(1);

    await page.reload();
    await expect(page.locator(".linked-sky-bar")).toBeVisible();
    expect(page.url()).toContain("date=2026-06-20");
    expect(Math.abs((await altitudeOf(page)) - 63.7)).toBeLessThan(1);

    await page.locator(".linked-sky-reset").click();
    await expect(page.locator(".linked-sky-bar")).toHaveCount(0);
    expect(page.url()).not.toContain("lat=");
    expect(page.url()).toContain("#/detail/dso-M42");
  });

  test("a June 21:00 link shows M42 below the horizon", async ({ page }) => {
    await page.goto(JUNE.replace("time=12:00", "time=21:00"));
    expect(await altitudeOf(page)).toBeLessThan(0);
  });

  test("a December 23:00 link gives a different altitude", async ({ page }) => {
    await page.goto(JUNE.replace("2026-06-20", "2026-12-20").replace("12:00", "23:00"));
    expect(Math.abs((await altitudeOf(page)) - 57.5)).toBeLessThan(1);
  });

  test("in-app navigation keeps the link", async ({ page }) => {
    await page.goto(JUNE);
    await expect(page.locator(".linked-sky-bar")).toBeVisible();
    await page.locator("nav a[href='#/search'], nav [data-hash='#/search']").first().click();
    await expect(page.locator(".search-input")).toBeVisible();
    await expect(page.locator(".linked-sky-bar")).toBeVisible();
    expect(page.url()).toContain("lat=-30.7");
  });

  test("a Perth link on a Sydney device shows Perth twilight times", async ({ page }) => {
    await page.goto("/?lat=-31.95&lng=115.86&date=2026-11-10&time=21:30&tz=Australia/Perth#/");
    await expect(page.locator(".linked-sky-bar")).toBeVisible();
    // Perth sunset on 10 Nov is 6:49 pm AWST (timeanddate.com); on the
    // Sydney clock it would read 9:49 pm.
    const sunset = await sunsetMinutes(page);
    expect(Math.abs(sunset - (18 * 60 + 49))).toBeLessThanOrEqual(2);
  });
});
