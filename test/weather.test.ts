import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTRIBUTION,
  cacheKey,
  handleWeather,
  hourBucket,
  secondsToHourEnd,
  shapeForecast,
  upstreamUrl,
  type CacheLike,
  type WeatherDeps,
} from "../functions/weather/core.ts";
import { cellId, parseForecast, toGridCell } from "../src/engine/cloud.ts";

// 20:30 AEDT, 18 Oct 2026 (the mobile suite's frozen clock).
const NOW = Date.parse("2026-10-18T09:30:00Z");
const HOUR = 3_600_000;

/** An Open-Meteo style answer: `n` hours from 00:00 UTC on 18 Oct. */
function upstream(n = 48, cover = (i: number) => (i * 7) % 101) {
  const t0 = Date.parse("2026-10-18T00:00:00Z") / 1000;
  return {
    latitude: -30.4,
    longitude: 152.9,
    hourly: {
      time: Array.from({ length: n }, (_, i) => t0 + i * 3600),
      cloud_cover_low: Array.from({ length: n }, (_, i) => cover(i)),
      cloud_cover_mid: Array.from({ length: n }, () => 10),
      cloud_cover_high: Array.from({ length: n }, () => 55.6),
      cloud_cover: Array.from({ length: n }, (_, i) => cover(i)),
      visibility: Array.from({ length: n }, () => 24140),
    },
  };
}

test("grid cell: rounds to 0.1°, so no precise location is used", () => {
  assert.deepEqual(toGridCell(-30.4567, 152.9123), { lat: -30.5, lon: 152.9 });
  assert.deepEqual(toGridCell("-30.44", "152.96"), { lat: -30.4, lon: 153 });
  assert.deepEqual(toGridCell("-0.04", "0.01"), { lat: 0, lon: 0 }, "no -0");
  assert.equal(cellId(toGridCell(-0.04, -0.04)!), "0.0,0.0");
  assert.equal(cellId(toGridCell(-30.45, 152.9)!), "-30.4,152.9");
  assert.deepEqual(toGridCell(90, -180), { lat: 90, lon: -180 });
});

test("grid cell: rejects missing, non-numeric and out-of-range input", () => {
  for (const [lat, lon] of [
    [null, "1"],
    ["", "1"],
    [" ", "1"],
    ["12abc", "1"],
    ["NaN", "1"],
    ["Infinity", "1"],
    ["90.01", "0"],
    ["-91", "0"],
    ["0", "180.5"],
    ["0", "-181"],
    [undefined, undefined],
  ] as const) {
    assert.equal(toGridCell(lat, lon), null, `${lat},${lon}`);
  }
});

test("cache key: one per cell per UTC hour, on our own origin", () => {
  const cell = toGridCell(-30.45, 152.9)!;
  const k = cacheKey("https://sky.incitat.io", cell, NOW);
  assert.equal(k, "https://sky.incitat.io/api/weather/cache/v1/-30.4,152.9/2026-10-18T09");
  assert.equal(cacheKey("https://sky.incitat.io", cell, NOW + 25 * 60_000), k, "same hour");
  assert.notEqual(cacheKey("https://sky.incitat.io", cell, NOW + HOUR), k, "next hour");
  assert.notEqual(cacheKey("https://sky.incitat.io", toGridCell(-30.55, 152.9)!, NOW), k);
  // Two nearby points in one cell share an entry.
  assert.equal(cacheKey("https://x", toGridCell(-30.41, 152.94)!, NOW), cacheKey("https://x", toGridCell(-30.44, 152.86)!, NOW));
  assert.equal(hourBucket(NOW), Date.parse("2026-10-18T09:00:00Z"));
  assert.equal(secondsToHourEnd(NOW), 30 * 60);
  assert.equal(secondsToHourEnd(Date.parse("2026-10-18T09:59:59.5Z")), 60, "at least a minute");
});

test("upstream URL asks Open-Meteo for cloud by level and visibility, 2 days, UTC unix time", () => {
  const u = new URL(upstreamUrl({ lat: -30.4, lon: 152.9 }));
  assert.equal(u.origin + u.pathname, "https://api.open-meteo.com/v1/forecast");
  assert.equal(u.searchParams.get("latitude"), "-30.4");
  assert.equal(u.searchParams.get("longitude"), "152.9");
  assert.equal(u.searchParams.get("hourly"), "cloud_cover_low,cloud_cover_mid,cloud_cover_high,cloud_cover,visibility");
  assert.equal(u.searchParams.get("forecast_days"), "2");
  assert.equal(u.searchParams.get("timeformat"), "unixtime");
  assert.equal(u.searchParams.get("timezone"), "GMT");
});

test("response shaping: ms timestamps, rounded and clamped values, nulls kept", () => {
  const raw = upstream(4);
  raw.hourly.cloud_cover[1] = null as unknown as number;
  raw.hourly.cloud_cover_low[2] = 104.2;
  const fc = shapeForecast(raw, { lat: -30.4, lon: 152.9 }, NOW)!;
  assert.ok(fc);
  assert.deepEqual(fc.t, [0, 1, 2, 3].map((i) => Date.parse("2026-10-18T00:00:00Z") + i * HOUR));
  assert.deepEqual(fc.total, [0, null, 14, 21]);
  assert.equal(fc.low[2], 100);
  assert.deepEqual(fc.high, [56, 56, 56, 56]);
  assert.deepEqual(fc.vis, [24140, 24140, 24140, 24140]);
  assert.deepEqual(fc.cell, { lat: -30.4, lon: 152.9 });
  assert.equal(fc.fetchedAt, NOW);
  // The client accepts exactly what the Function produces.
  assert.deepEqual(parseForecast(JSON.parse(JSON.stringify(fc))), fc);
});

test("response shaping: malformed upstream answers give null", () => {
  const cell = { lat: 0, lon: 0 };
  assert.equal(shapeForecast(null, cell, NOW), null);
  assert.equal(shapeForecast({}, cell, NOW), null);
  assert.equal(shapeForecast({ hourly: { time: [1] } }, cell, NOW), null);
  const ragged = upstream(4);
  ragged.hourly.cloud_cover_mid.pop();
  assert.equal(shapeForecast(ragged, cell, NOW), null);
  const missing = upstream(4) as { hourly: Record<string, unknown> };
  delete missing.hourly.visibility;
  assert.equal(shapeForecast(missing, cell, NOW), null);
  const text = upstream(4);
  (text.hourly.cloud_cover as unknown[])[0] = "cloudy";
  assert.equal(shapeForecast(text, cell, NOW), null);
});

test("client parse rejects bad shapes", () => {
  assert.equal(parseForecast(null), null);
  assert.equal(parseForecast({ cell: { lat: 0, lon: 0 }, fetchedAt: 1, t: [2, 1], low: [0, 0], mid: [0, 0], high: [0, 0], total: [0, 0], vis: [0, 0] }), null, "time must increase");
  assert.equal(parseForecast({ cell: { lat: 0, lon: 0 }, fetchedAt: 1, t: [1, 2], low: [0], mid: [0, 0], high: [0, 0], total: [0, 0], vis: [0, 0] }), null);
});

// ── The handler, with a fake Cache API and fetch ─────────────────────

function fakeDeps(opts: { fail?: boolean; status?: number } = {}) {
  const store = new Map<string, string>();
  const calls: string[] = [];
  const pending: Promise<unknown>[] = [];
  const cache: CacheLike = {
    async match(key) {
      const body = store.get(key);
      return body === undefined ? undefined : new Response(body);
    },
    async put(key, res) {
      store.set(key, await res.text());
    },
  };
  let now = NOW;
  const deps: WeatherDeps = {
    cache,
    fetch: async (url) => {
      calls.push(url);
      if (opts.fail) throw new Error("network down");
      return new Response(JSON.stringify(upstream()), { status: opts.status ?? 200 });
    },
    now: () => now,
    waitUntil: (p) => {
      pending.push(p);
    },
  };
  return {
    deps,
    calls,
    store,
    setNow: (ms: number) => {
      now = ms;
    },
    settle: () => Promise.all(pending),
  };
}

const req = (q: string) => new Request(`https://sky.incitat.io/api/weather?${q}`);

test("handler: first call fetches and caches, second is a cache hit with no upstream call", async () => {
  const f = fakeDeps();
  const a = await handleWeather(req("lat=-30.45&lon=152.9"), f.deps);
  assert.equal(a.status, 200);
  assert.equal(a.headers.get("X-Weather-Cache"), "MISS");
  assert.equal(a.headers.get("Cache-Control"), "public, max-age=1800");
  const body = (await a.json()) as { ok: boolean; data: unknown; attribution: string };
  assert.equal(body.ok, true);
  assert.equal(body.attribution, ATTRIBUTION);
  assert.ok(parseForecast(body.data));
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0], /latitude=-30\.4&longitude=152\.9/, "upstream sees only the cell");
  await f.settle();

  // Another point in the same cell, later in the same hour.
  f.setNow(NOW + 20 * 60_000);
  const b = await handleWeather(req("lat=-30.42&lon=152.93"), f.deps);
  assert.equal(b.status, 200);
  assert.equal(b.headers.get("X-Weather-Cache"), "HIT");
  assert.equal(b.headers.get("Cache-Control"), "public, max-age=600");
  assert.deepEqual(await b.json(), body);
  assert.equal(f.calls.length, 1, "Open-Meteo called once per cell per hour");

  // Next hour: a fresh fetch.
  f.setNow(NOW + HOUR);
  const c = await handleWeather(req("lat=-30.45&lon=152.9"), f.deps);
  assert.equal(c.headers.get("X-Weather-Cache"), "MISS");
  assert.equal(f.calls.length, 2);
});

test("handler: bad coordinates give 400 JSON and never reach upstream", async () => {
  const f = fakeDeps();
  for (const q of ["", "lat=abc&lon=1", "lat=95&lon=0", "lat=0&lon=200", "lat=-30"]) {
    const r = await handleWeather(req(q), f.deps);
    assert.equal(r.status, 400, q);
    assert.equal(r.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await r.json(), { ok: false, error: "lat and lon must be numbers in range" });
  }
  assert.equal(f.calls.length, 0);
});

test("handler: upstream failure gives 502 JSON and caches nothing", async () => {
  for (const opts of [{ fail: true }, { status: 503 }]) {
    const f = fakeDeps(opts);
    const errors: unknown[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => errors.push(a.join(" "));
    try {
      const r = await handleWeather(req("lat=-30.45&lon=152.9"), f.deps);
      assert.equal(r.status, 502);
      assert.equal(r.headers.get("Cache-Control"), "no-store");
      assert.deepEqual(await r.json(), { ok: false, error: "forecast unavailable" });
    } finally {
      console.error = orig;
    }
    await f.settle();
    assert.equal(f.store.size, 0);
    // Logs say what failed, never where.
    assert.ok(errors.length > 0);
    for (const e of errors) assert.doesNotMatch(String(e), /30\.|152/);
  }
});

test("handler: works without a cache (local dev)", async () => {
  const f = fakeDeps();
  f.deps.cache = null;
  const r = await handleWeather(req("lat=1&lon=2"), f.deps);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("X-Weather-Cache"), "MISS");
});
