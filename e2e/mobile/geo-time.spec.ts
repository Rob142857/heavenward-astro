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
    // Params are stripped from the address bar after reading.
    expect(page.url()).not.toContain("lat=");
  });

  test("deep link twilight times are on the link's clock, not the device's", async ({ page }) => {
    test.info().annotations.push({
      type: "known-bug",
      description:
        "TODO(feature worker): twilight fmt() in src/ui/tonight.ts ignores ctx.atZone, so a Brisbane link opened in Sydney (AEDT) shows sunset an hour later than the Brisbane clock in the linked-sky bar.",
    });
    test.fail();
    await page.goto(
      "/?lat=-27.47&lng=153.03&date=2026-11-10&time=21:30&tz=Australia/Brisbane#/",
    );
    await expect(page.locator(".linked-sky-bar")).toBeVisible();
    const sunset = await sunsetMinutes(page);
    // Brisbane sunset in November is about 6:15 pm AEST (no DST).
    expect(sunset).toBeLessThan(18 * 60 + 45);
  });
});
