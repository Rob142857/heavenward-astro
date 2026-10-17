import { test, expect, gotoApp, horizontalOverflow } from "./fixtures";

// The altitude chart on object pages. Frozen clock: 20:30 AEDT, 18 Oct 2026,
// at the invented NSW location (-31.4, 147.9).

const PAGES: { name: string; hash: string }[] = [
  { name: "DSO (M42)", hash: "#/detail/dso-M42" },
  { name: "star (Sirius)", hash: "#/detail/star-sirius" },
  { name: "planet (Jupiter)", hash: "#/detail/planet-jupiter" },
  { name: "Moon", hash: "#/detail/moon" },
];

for (const p of PAGES) {
  test(`chart renders for a ${p.name}`, async ({ page, consoleErrors }) => {
    await gotoApp(page, p.hash);
    const chart = page.locator(".alt-chart");
    await expect(chart).toBeVisible();
    await expect(chart.locator(".alt-curve")).toHaveAttribute("d", /^M[\d.]+,/);
    await expect(chart.locator(".alt-band-dark")).toHaveCount(1);
    await expect(chart.locator(".alt-summary")).not.toBeEmpty();
    await expect(chart.locator(".alt-rts-grid .detail-item").first()).toBeVisible();
    // The "now" marker: 20:30 is inside tonight's window.
    await expect(chart.locator(".alt-now")).toHaveCount(1);
    expect(consoleErrors).toEqual([]);
  });
}

test("M42: rise, transit and set marks match the numbers on the page", async ({ page }) => {
  await gotoApp(page, "#/detail/dso-M42");
  const chart = page.locator(".alt-chart");
  await expect(chart.locator(".alt-summary")).toContainText(/\d/);
  const items = chart.locator(".alt-rts-grid .detail-item .value");
  await expect(items).toHaveCount(3);
  // Rise and set in the grid, and a mark for each on the curve.
  await expect(items.nth(0)).toContainText(/\d:\d\d/);
  await expect(items.nth(1)).toContainText(/\d:\d\d.*\d+°/);
  await chart.locator(".alt-span-btn[data-span='24h']").click();
  await expect(chart.locator(".alt-mark-rise")).toHaveCount(1);
  await expect(chart.locator(".alt-mark-transit")).toHaveCount(1);
  await expect(chart.locator(".alt-mark-set")).toHaveCount(1);
});

test("scrubbing by touch and by keyboard updates the readout", async ({ page }) => {
  await gotoApp(page, "#/detail/dso-M42");
  const plot = page.locator(".alt-plot");
  const readout = page.locator(".alt-readout");
  await expect(readout).toContainText(/°.*Moon/);
  const before = await readout.textContent();

  const box = (await plot.locator("svg").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.85, box.y + box.height / 2);
  await page.mouse.up();
  const afterDrag = await readout.textContent();
  expect(afterDrag).not.toEqual(before);

  await plot.focus();
  await page.keyboard.press("PageDown");
  await expect(readout).not.toHaveText(afterDrag ?? "");
  await expect(plot).toHaveAttribute("aria-valuetext", (await readout.textContent()) ?? "");
});

test("the minimum-altitude choice moves the line and the best window", async ({ page }) => {
  await gotoApp(page, "#/detail/dso-M42");
  const chart = page.locator(".alt-chart");
  const line = chart.locator(".alt-minline");
  const y30 = await line.getAttribute("y1");
  await chart.locator(".alt-min-select").selectOption("60");
  await expect(line).not.toHaveAttribute("y1", y30 ?? "");
  // M42 peaks at about 64° here, so a 60° window is short but real.
  await expect(chart.locator(".alt-summary")).toContainText(/–/);
});

test("LMC is circumpolar here and Polaris never rises", async ({ page }) => {
  await gotoApp(page, "#/detail/dso-LMC");
  await expect(page.locator(".alt-rts-grid")).toContainText("Always up");
  await gotoApp(page, "#/detail/star-polaris");
  await expect(page.locator(".alt-rts-grid")).toContainText("Never rises here");
  await expect(page.locator(".alt-summary")).toContainText("Never rises here");
});

test("a linked time and zone drive the chart's clock", async ({ page }) => {
  // 21:30 Perth time; the device clock is Sydney (three hours ahead).
  await page.goto("/?lat=-31.95&lng=115.86&date=2026-11-10&time=21:30&tz=Australia/Perth#/detail/dso-M42");
  const chart = page.locator(".alt-chart");
  await expect(chart).toBeVisible();
  await expect(chart.locator(".alt-now-label")).toHaveText("Link");
  // The scrubber starts on the link's time, printed on Perth's clock.
  await expect(page.locator(".alt-readout")).toContainText(/09:30\s*pm|21:30/i);
});

test("the object page has no sideways scroll with the chart at 360 px", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: page.viewportSize()!.height });
  await gotoApp(page, "#/detail/dso-M42");
  await expect(page.locator(".alt-chart")).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});
