/**
 * Cloud forecast helpers ("Is it clear?"). Pure, no DOM, so they run in Node
 * tests and in the Pages Function.
 *
 * The forecast is Open-Meteo's hourly cloud cover by level plus visibility,
 * fetched through our own /api/weather Function (never from the browser
 * directly). Times are UTC epoch milliseconds, the same clock as the rest of
 * the engine; the UI prints them in the page's zone.
 */

/** Grid step for the forecast cell, degrees. 0.1° is about 11 km. */
export const GRID_DEG = 0.1;

export interface GridCell {
  lat: number;
  lon: number;
}

/** Round to one decimal and drop "-0", so equal cells print the same. */
function round1(x: number): number {
  const r = Math.round(x * 10) / 10;
  return Object.is(r, -0) ? 0 : r;
}

/**
 * The forecast cell for a place: lat/lon rounded to 0.1°. Returns null for
 * anything that is not a finite latitude (-90..90) and longitude (-180..180).
 * Accepts strings so the Function can pass query parameters straight in;
 * an empty or partly numeric string ("12abc") is rejected.
 */
export function toGridCell(lat: unknown, lon: unknown): GridCell | null {
  const num = (v: unknown): number | null => {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v !== "string" || v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const la = num(lat);
  const lo = num(lon);
  if (la === null || lo === null) return null;
  if (la < -90 || la > 90 || lo < -180 || lo > 180) return null;
  return { lat: round1(la), lon: round1(lo) };
}

/** "-30.4,152.9": the cell as it appears in URLs and cache keys. */
export function cellId(c: GridCell): string {
  return `${c.lat.toFixed(1)},${c.lon.toFixed(1)}`;
}

/** Hourly forecast, parallel arrays. Cover in percent (0-100), visibility in metres. */
export interface CloudForecast {
  cell: GridCell;
  /** When the Function fetched it from Open-Meteo, ms. */
  fetchedAt: number;
  t: number[];
  low: (number | null)[];
  mid: (number | null)[];
  high: (number | null)[];
  total: (number | null)[];
  vis: (number | null)[];
}

const SERIES = ["low", "mid", "high", "total", "vis"] as const;

const isNumOrNull = (v: unknown): v is number | null =>
  v === null || (typeof v === "number" && Number.isFinite(v));

/** Validate an untrusted forecast (from the network). Null if malformed. */
export function parseForecast(x: unknown): CloudForecast | null {
  if (typeof x !== "object" || x === null) return null;
  const o = x as Record<string, unknown>;
  const cell = o.cell as Record<string, unknown> | undefined;
  if (!cell || typeof cell.lat !== "number" || typeof cell.lon !== "number") return null;
  if (typeof o.fetchedAt !== "number") return null;
  const t = o.t;
  if (!Array.isArray(t) || t.length < 2 || !t.every((v) => typeof v === "number" && Number.isFinite(v)))
    return null;
  for (let i = 1; i < t.length; i++) if (t[i] <= t[i - 1]) return null;
  for (const k of SERIES) {
    const a = o[k];
    if (!Array.isArray(a) || a.length !== t.length || !a.every(isNumOrNull)) return null;
  }
  return {
    cell: { lat: cell.lat, lon: cell.lon },
    fetchedAt: o.fetchedAt,
    t: t as number[],
    low: o.low as (number | null)[],
    mid: o.mid as (number | null)[],
    high: o.high as (number | null)[],
    total: o.total as (number | null)[],
    vis: o.vis as (number | null)[],
  };
}

/**
 * Total cloud cover (0-1) at `ms`, linearly interpolated between the hourly
 * values. Null outside the forecast or next to a missing value, so a deep
 * link to next month scores exactly as with no forecast.
 */
export function cloudAt(fc: CloudForecast, ms: number): number | null {
  const { t, total } = fc;
  if (!t.length || ms < t[0] || ms > t[t.length - 1]) return null;
  let lo = 0;
  let hi = t.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (t[m] <= ms) lo = m;
    else hi = m;
  }
  const a = total[lo];
  const b = total[hi];
  if (t[lo] === ms) return a === null ? null : clamp01(a / 100);
  if (t[hi] === ms) return b === null ? null : clamp01(b / 100);
  if (a === null || b === null) return null;
  const f = (ms - t[lo]) / (t[hi] - t[lo]);
  return clamp01((a + (b - a) * f) / 100);
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** The `cloud` option for rankTonightsBest, or undefined with no forecast. */
export function cloudOption(
  fc: CloudForecast | null | undefined,
): ((ms: number) => number | null) | undefined {
  return fc ? (ms) => cloudAt(fc, ms) : undefined;
}

export interface CloudHour {
  t: number;
  low: number | null;
  mid: number | null;
  high: number | null;
  total: number | null;
  vis: number | null;
}

/**
 * The forecast hours that fall in a night window: from the hour containing
 * `start` to the last hour at or before `end`.
 */
export function hoursInWindow(fc: CloudForecast, start: number, end: number): CloudHour[] {
  const from = Math.floor(start / 3_600_000) * 3_600_000;
  const out: CloudHour[] = [];
  for (let i = 0; i < fc.t.length; i++) {
    const t = fc.t[i];
    if (t < from || t > end) continue;
    out.push({
      t,
      low: fc.low[i],
      mid: fc.mid[i],
      high: fc.high[i],
      total: fc.total[i],
      vis: fc.vis[i],
    });
  }
  return out;
}

export type CloudVerdict = "clear" | "mostlyClear" | "partly" | "mostlyCloudy" | "cloudy";

export interface CloudSummary {
  verdict: CloudVerdict;
  /** Mean total cover over the hours, percent. */
  meanPct: number;
  /** Lowest visibility over the hours, metres, or null. */
  minVis: number | null;
}

/** One-word answer to "is it clear?" for a set of hours, or null if empty. */
export function summariseHours(hours: CloudHour[]): CloudSummary | null {
  const totals = hours.map((h) => h.total).filter((v): v is number => v !== null);
  if (!totals.length) return null;
  const meanPct = totals.reduce((s, v) => s + v, 0) / totals.length;
  const vis = hours.map((h) => h.vis).filter((v): v is number => v !== null);
  return {
    verdict: verdictFor(meanPct),
    meanPct: Math.round(meanPct),
    minVis: vis.length ? Math.min(...vis) : null,
  };
}

export function verdictFor(meanPct: number): CloudVerdict {
  if (meanPct < 15) return "clear";
  if (meanPct < 35) return "mostlyClear";
  if (meanPct < 65) return "partly";
  if (meanPct < 85) return "mostlyCloudy";
  return "cloudy";
}
