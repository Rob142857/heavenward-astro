import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyCuratedDSO, type DSOEntry } from "../src/catalog/dso.ts";
import { SHOWPIECE_DOUBLES } from "../src/catalog/doubles.ts";
import {
  cloudAt,
  cloudOption,
  hoursInWindow,
  summariseHours,
  verdictFor,
  type CloudForecast,
} from "../src/engine/cloud.ts";
import { buildCandidates, rankTonightsBest, whyParts } from "../src/engine/tonight-best.ts";

const HOUR = 3_600_000;
const T0 = Date.parse("2026-10-18T00:00:00Z");

function forecast(total: (number | null)[], extra: Partial<CloudForecast> = {}): CloudForecast {
  const n = total.length;
  return {
    cell: { lat: -30.4, lon: 152.9 },
    fetchedAt: T0,
    t: Array.from({ length: n }, (_, i) => T0 + i * HOUR),
    low: Array.from({ length: n }, () => 5),
    mid: Array.from({ length: n }, () => 10),
    high: total.map((v) => v),
    total,
    vis: Array.from({ length: n }, () => 24000),
    ...extra,
  };
}

test("interpolation: linear between hours, exact on the hour", () => {
  const fc = forecast([0, 100, 40]);
  assert.equal(cloudAt(fc, T0), 0);
  assert.equal(cloudAt(fc, T0 + HOUR), 1);
  assert.equal(cloudAt(fc, T0 + HOUR / 2), 0.5);
  assert.ok(Math.abs(cloudAt(fc, T0 + 1.25 * HOUR)! - 0.85) < 1e-9);
  assert.equal(cloudAt(fc, T0 + 2 * HOUR), 0.4);
});

test("interpolation: null outside the forecast and next to a missing hour", () => {
  const fc = forecast([20, null, 40, 60]);
  assert.equal(cloudAt(fc, T0 - 1), null);
  assert.equal(cloudAt(fc, T0 + 3 * HOUR + 1), null);
  assert.equal(cloudAt(fc, T0 + HOUR / 2), null);
  assert.equal(cloudAt(fc, T0 + HOUR), null);
  assert.equal(cloudAt(fc, T0 + 2.5 * HOUR), 0.5);
  assert.equal(cloudOption(null), undefined);
  assert.equal(cloudOption(undefined), undefined);
  assert.equal(cloudOption(fc)!(T0 + 3 * HOUR), 0.6);
});

test("hours in a window: from the hour containing the start to the end", () => {
  const fc = forecast(Array.from({ length: 24 }, (_, i) => i));
  const h = hoursInWindow(fc, T0 + 9.4 * HOUR, T0 + 18.75 * HOUR);
  assert.deepEqual(h.map((x) => x.total), [9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
  assert.deepEqual(hoursInWindow(fc, T0 + 30 * HOUR, T0 + 40 * HOUR), []);
});

test("summary: verdict bands, mean and lowest visibility", () => {
  assert.equal(verdictFor(0), "clear");
  assert.equal(verdictFor(14.9), "clear");
  assert.equal(verdictFor(15), "mostlyClear");
  assert.equal(verdictFor(50), "partly");
  assert.equal(verdictFor(70), "mostlyCloudy");
  assert.equal(verdictFor(85), "cloudy");
  const fc = forecast([10, 20, null, 30], { vis: [24000, 3500, null, 20000] });
  const s = summariseHours(hoursInWindow(fc, T0, T0 + 3 * HOUR))!;
  assert.deepEqual(s, { verdict: "mostlyClear", meanPct: 20, minVis: 3500 });
  assert.equal(summariseHours([]), null);
  assert.equal(summariseHours(hoursInWindow(forecast([null, null]), T0, T0 + HOUR)), null);
});

// ── Tonight's Best with and without a forecast ───────────────────────

const BELLINGEN = { lat: -30.45, lon: 152.9, elev: 0 };
const EVENING = new Date("2026-10-18T09:30:00Z");
const dsos = applyCuratedDSO(
  JSON.parse(readFileSync("src/catalog/dso.json", "utf8")) as DSOEntry[],
  JSON.parse(readFileSync("src/catalog/dso-curated.json", "utf8")),
);
const stars = JSON.parse(readFileSync("src/catalog/stars.json", "utf8"));
const CANDS = buildCandidates(dsos, stars, SHOWPIECE_DOUBLES);
const summary = (r: ReturnType<typeof rankTonightsBest>) =>
  r.rows.map((x) => `${x.cand.id}:${x.score}:${x.cloudMean}`);

test("a missing forecast leaves the ranking identical", () => {
  const base = summary(rankTonightsBest(CANDS, BELLINGEN, EVENING));
  assert.ok(base.length > 5);
  assert.deepEqual(summary(rankTonightsBest(CANDS, BELLINGEN, EVENING, { cloud: undefined })), base);
  assert.deepEqual(summary(rankTonightsBest(CANDS, BELLINGEN, EVENING, { cloud: cloudOption(null) })), base);
  assert.deepEqual(summary(rankTonightsBest(CANDS, BELLINGEN, EVENING, { cloud: () => null })), base);
  // A forecast for another week covers none of tonight: same again.
  const nextWeek = forecast([90, 90, 90], { t: [0, 1, 2].map((i) => T0 + (200 + i) * HOUR) });
  assert.deepEqual(summary(rankTonightsBest(CANDS, BELLINGEN, EVENING, { cloud: cloudOption(nextWeek) })), base);
});

test("a forecast feeds the 10-point cloud term and the why line", () => {
  const plain = rankTonightsBest(CANDS, BELLINGEN, EVENING);
  const overcast = forecast(Array.from({ length: 48 }, () => 100));
  const cloudy = rankTonightsBest(CANDS, BELLINGEN, EVENING, { cloud: cloudOption(overcast) });
  // Uniform cover costs every row the same 10 points, so the order holds.
  assert.deepEqual(cloudy.rows.map((r) => r.cand.id), plain.rows.map((r) => r.cand.id));
  for (const [i, r] of cloudy.rows.entries()) {
    assert.equal(r.cloudMean, 1);
    assert.equal(r.parts.cloud, 0);
    assert.ok(Math.abs(plain.rows[i].score - r.score - 10) < 0.11, r.cand.name);
  }
  const why = whyParts(cloudy.rows[0], { minAlt: 30, equipment: "binoculars" });
  assert.deepEqual(why[1], { key: "best.why.cloud", params: { pct: 100 } }, "cloud is in the three shown");
  const clear = rankTonightsBest(CANDS, BELLINGEN, EVENING, {
    cloud: cloudOption(forecast(Array.from({ length: 48 }, () => 0))),
  });
  assert.deepEqual(clear.rows.map((r) => r.score), plain.rows.map((r) => r.score), "clear sky = no-forecast score");
});
