import { test, expect, gotoApp, openEverything } from "./fixtures";

// Tonight's cards show only tonight's rise and set (sunset to sunrise), in
// the order they happen. The fixtures freeze 20:30 AEDT on 18 Oct 2026 at an
// invented inland NSW point (-31.4, 147.9).

/** "07:56 pm" -> minutes after noon, so a night's times sort correctly. */
function afterNoon(text: string): number {
  const m = text.match(/(\d{1,2}):(\d{2})\s*([ap]\.?m\.?)?/i);
  if (!m) throw new Error(`no time in "${text}"`);
  let h = Number(m[1]);
  if (m[3]) h = (h % 12) + (/p/i.test(m[3]) ? 12 : 0);
  return (h * 60 + Number(m[2]) - 12 * 60 + 24 * 60) % (24 * 60);
}

test("rise and set times on Tonight's cards are tonight's, in order", async ({ page }) => {
  await gotoApp(page, "#/");
  await openEverything(page);
  await expect(page.locator(".card-grid .card:not(.skeleton)").first()).toBeVisible();
  const rows = await page.locator(".card-grid .card .card-times").allTextContents();
  expect(rows.length).toBeGreaterThan(10);
  // Every printed time falls inside tonight, as shown in the twilight bar.
  const quick = page.locator(".twilight-quick span");
  const sunset = afterNoon((await quick.first().textContent()) ?? "") - 1;
  const sunrise = afterNoon((await quick.last().textContent()) ?? "") + 1;
  let withTimes = 0;
  for (const row of rows) {
    const times = [...row.matchAll(/([↑↓])\s*(\d{1,2}:\d{2}\s*(?:[ap]\.?m\.?)?)/gi)].map((m) => afterNoon(m[2]));
    if (!times.length) continue;
    withTimes++;
    for (const t of times) {
      expect(t, row).toBeGreaterThanOrEqual(sunset);
      expect(t, row).toBeLessThanOrEqual(sunrise);
    }
    expect(times, row).toEqual([...times].sort((a, b) => a - b));
  }
  expect(withTimes).toBeGreaterThan(0);
});

test("Canopus shows tonight's rise (no daytime set) and Acrux is always up", async ({ page }) => {
  await gotoApp(page, "#/");
  await openEverything(page);
  const canopus = page.locator(".card", { has: page.locator(".card-title", { hasText: /^Canopus$/ }) });
  await expect(canopus).toBeVisible();
  const text = (await canopus.locator(".card-times").textContent()) ?? "";
  expect(text).toMatch(/↑/);
  expect(text).not.toMatch(/↓/);

  const acrux = page.locator(".card", { has: page.locator(".card-title", { hasText: /^Acrux$/ }) });
  await expect(acrux.locator(".card-times")).toContainText("Always up");
});
