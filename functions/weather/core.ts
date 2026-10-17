/**
 * GET /api/weather?lat=..&lon=.. : tonight's cloud forecast for a 0.1° cell.
 *
 * Public (no auth). The browser never calls Open-Meteo itself; this Function
 * does, at most once per cell per hour, and keeps the answer in the
 * Cloudflare Cache API (caches.default). Coordinates are rounded to the cell
 * before anything else happens, and nothing about the location is logged.
 *
 * Weather data by Open-Meteo.com (https://open-meteo.com/), CC BY 4.0. Used
 * on the free non-commercial tier: Heavenward is non-commercial (owner's
 * decision, 18 Oct 2026).
 *
 * Kept free of Hono and Workers globals so Node tests can drive it with a
 * fake cache and fetch.
 */
import { cellId, toGridCell, type CloudForecast, type GridCell } from "../../src/engine/cloud.ts";

export const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
export const HOURLY_VARS = "cloud_cover_low,cloud_cover_mid,cloud_cover_high,cloud_cover,visibility";
export const FORECAST_DAYS = 2;
export const ATTRIBUTION = "Weather data by Open-Meteo.com (CC BY 4.0)";
const HOUR_MS = 3_600_000;

/** Open-Meteo request for a cell: UTC unix timestamps, so no zone guessing. */
export function upstreamUrl(cell: GridCell): string {
  const q = new URLSearchParams({
    latitude: cell.lat.toFixed(1),
    longitude: cell.lon.toFixed(1),
    hourly: HOURLY_VARS,
    forecast_days: String(FORECAST_DAYS),
    timeformat: "unixtime",
    timezone: "GMT",
  });
  return `${OPEN_METEO_URL}?${q}`;
}

/** Start of the UTC hour `now` is in, ms. The cache bucket. */
export function hourBucket(now: number): number {
  return Math.floor(now / HOUR_MS) * HOUR_MS;
}

/** Seconds left in the current hour (at least 60), for Cache-Control. */
export function secondsToHourEnd(now: number): number {
  return Math.max(60, Math.ceil((hourBucket(now) + HOUR_MS - now) / 1000));
}

/**
 * Cache API key for a cell and hour. A synthetic URL on our own origin; the
 * hour is in the path, so a new hour is a new entry and Open-Meteo sees at
 * most one call per cell per hour.
 */
export function cacheKey(origin: string, cell: GridCell, now: number): string {
  const hour = new Date(hourBucket(now)).toISOString().slice(0, 13);
  return `${origin}/api/weather/cache/v1/${cellId(cell)}/${hour}`;
}

/**
 * Open-Meteo's JSON to our small shape. Null if the upstream answer is not
 * what we asked for (missing series, ragged arrays, bad numbers).
 */
export function shapeForecast(raw: unknown, cell: GridCell, fetchedAt: number): CloudForecast | null {
  if (typeof raw !== "object" || raw === null) return null;
  const hourly = (raw as Record<string, unknown>).hourly;
  if (typeof hourly !== "object" || hourly === null) return null;
  const h = hourly as Record<string, unknown>;
  const time = h.time;
  if (!Array.isArray(time) || time.length < 2) return null;
  if (!time.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  const series = (name: string, max: number): (number | null)[] | null => {
    const a = h[name];
    if (!Array.isArray(a) || a.length !== time.length) return null;
    const out: (number | null)[] = [];
    for (const v of a) {
      if (v === null) out.push(null);
      else if (typeof v === "number" && Number.isFinite(v)) out.push(Math.max(0, Math.min(max, Math.round(v))));
      else return null;
    }
    return out;
  };
  const low = series("cloud_cover_low", 100);
  const mid = series("cloud_cover_mid", 100);
  const high = series("cloud_cover_high", 100);
  const total = series("cloud_cover", 100);
  const vis = series("visibility", 1_000_000);
  if (!low || !mid || !high || !total || !vis) return null;
  return {
    cell,
    fetchedAt,
    t: (time as number[]).map((s) => s * 1000),
    low,
    mid,
    high,
    total,
    vis,
  };
}

/** Minimal Cache API surface (caches.default in Workers). */
export interface CacheLike {
  match(key: string): Promise<Response | undefined>;
  put(key: string, res: Response): Promise<void>;
}

export interface WeatherDeps {
  cache: CacheLike | null;
  fetch: (url: string) => Promise<Response>;
  now: () => number;
  waitUntil: (p: Promise<unknown>) => void;
}

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

/** Handle one /api/weather request. */
export async function handleWeather(req: Request, deps: WeatherDeps): Promise<Response> {
  const url = new URL(req.url);
  const cell = toGridCell(url.searchParams.get("lat"), url.searchParams.get("lon"));
  if (!cell) {
    return json({ ok: false, error: "lat and lon must be numbers in range" }, 400, {
      "Cache-Control": "no-store",
    });
  }
  const now = deps.now();
  const key = cacheKey(url.origin, cell, now);
  const maxAge = secondsToHourEnd(now);

  const hit = await deps.cache?.match(key).catch(() => undefined);
  if (hit) {
    const body = await hit.text();
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": `public, max-age=${maxAge}`,
        "X-Weather-Cache": "HIT",
      },
    });
  }

  let data: CloudForecast | null = null;
  try {
    const res = await deps.fetch(upstreamUrl(cell));
    if (res.ok) data = shapeForecast(await res.json(), cell, now);
    else console.error(`[weather] upstream status ${res.status}`);
  } catch {
    console.error("[weather] upstream fetch failed");
  }
  if (!data) {
    return json({ ok: false, error: "forecast unavailable" }, 502, { "Cache-Control": "no-store" });
  }

  const body = JSON.stringify({ ok: true, data, attribution: ATTRIBUTION });
  if (deps.cache) {
    const stored = new Response(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": `public, max-age=${maxAge}`,
      },
    });
    deps.waitUntil(deps.cache.put(key, stored).catch(() => undefined));
  }
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${maxAge}`,
      "X-Weather-Cache": "MISS",
    },
  });
}
