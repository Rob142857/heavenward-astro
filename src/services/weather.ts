/**
 * Cloud forecast for the current location, through our /api/weather
 * Function (which caches Open-Meteo per 0.1° cell per hour).
 *
 * Only the rounded cell leaves the device, never the precise position. Any
 * failure (offline, timeout, bad answer, upstream down) resolves to null, and
 * the app then behaves exactly as it does without a forecast.
 */
import type { GeoLocation } from "../types.js";
import { cellId, parseForecast, toGridCell, type CloudForecast } from "../engine/cloud.ts";

const TIMEOUT_MS = 5_000;
const HOUR_MS = 3_600_000;

/** One request per cell per hour per page load, shared by every caller. */
const memo = new Map<string, Promise<CloudForecast | null>>();

export function fetchCloudForecast(loc: GeoLocation): Promise<CloudForecast | null> {
  const cell = toGridCell(loc.lat, loc.lon);
  if (!cell) return Promise.resolve(null);
  const key = `${cellId(cell)}|${Math.floor(Date.now() / HOUR_MS)}`;
  let p = memo.get(key);
  if (!p) {
    p = load(cell.lat, cell.lon);
    memo.set(key, p);
    // A failure is not remembered: the next view tries again.
    void p.then((fc) => {
      if (!fc) memo.delete(key);
    });
  }
  return p;
}

async function load(lat: number, lon: number): Promise<CloudForecast | null> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const q = new URLSearchParams({ lat: lat.toFixed(1), lon: lon.toFixed(1) });
    const res = await fetch(`/api/weather?${q}`, {
      signal: ctrl.signal,
      credentials: "omit",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (typeof body !== "object" || body === null || (body as { ok?: unknown }).ok !== true) return null;
    return parseForecast((body as { data?: unknown }).data);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Wait at most `ms` for the forecast; null after that (the page carries on). */
export function forecastWithin(loc: GeoLocation, ms: number): Promise<CloudForecast | null> {
  return Promise.race([
    fetchCloudForecast(loc),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}
