/**
 * Deep links into the sky report: `/?lat=-27.47&lng=153.03&date=2026-11-10&time=21:30&tz=Australia/Brisbane`
 *
 * - `lat` + `lng` (or `lon`) set the observing place for this visit only.
 *   They are never saved over the user's own location.
 * - `date` (YYYY-MM-DD) with optional `time` (HH:MM, default 21:00) sets the
 *   moment the report is computed for. `tz` (an IANA zone) says whose clock
 *   that date and time are on; without it the browser's own zone is used.
 *
 * Pure: no DOM, no storage, so it can be tested in Node.
 */
import type { GeoLocation } from "../types.js";

export interface SkyLink {
  location: GeoLocation | null;
  at: Date | null;
  /** The link's own time zone, for showing `at` on that clock. */
  zone: string | null;
}

const DEFAULT_TIME = "21:00";

function finiteIn(value: string | null, limit: number): number | null {
  if (value === null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

function validZone(tz: string | null): string | null {
  if (!tz || tz.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

/** Offset of `zone` from UTC at `instant`, in minutes (east positive). */
export function zoneOffsetMinutes(zone: string, instant: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / 60_000);
}

/** The UTC instant of a wall-clock time in `zone`. */
export function zonedTimeToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  zone: string,
): Date {
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let guess = wall - zoneOffsetMinutes(zone, wall) * 60_000;
  // A second pass settles instants near a daylight-saving change.
  guess = wall - zoneOffsetMinutes(zone, guess) * 60_000;
  return new Date(guess);
}

export function parseSkyLink(search: string): SkyLink {
  const params = new URLSearchParams(search);
  const lat = finiteIn(params.get("lat"), 90);
  const lon = finiteIn(params.get("lng") ?? params.get("lon"), 180);
  const location =
    lat !== null && lon !== null && !(lat === 0 && lon === 0)
      ? { lat, lon, elev: 0 }
      : null;

  let at: Date | null = null;
  let zone: string | null = null;
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(params.get("date") ?? "");
  const time = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(
    params.get("time") ?? DEFAULT_TIME,
  ) ?? /^(\d{2}):(\d{2})$/.exec(DEFAULT_TIME);
  if (date && time) {
    const [y, mo, d] = [Number(date[1]), Number(date[2]), Number(date[3])];
    const [h, mi] = [Number(time[1]), Number(time[2])];
    const check = new Date(Date.UTC(y, mo - 1, d));
    const real =
      check.getUTCFullYear() === y &&
      check.getUTCMonth() === mo - 1 &&
      check.getUTCDate() === d &&
      y >= 1900 &&
      y <= 2200;
    if (real) {
      zone = validZone(params.get("tz"));
      at = zone
        ? zonedTimeToUtc(y, mo, d, h, mi, zone)
        : new Date(y, mo - 1, d, h, mi);
    }
  }
  return { location, at, zone: at ? zone : null };
}

/** True when the URL carries anything this module understands. */
export function hasSkyLink(search: string): boolean {
  const params = new URLSearchParams(search);
  return ["lat", "lng", "lon", "date", "time", "tz"].some((k) => params.has(k));
}

/** Remove the deep-link params from a URL, keeping everything else. */
export function stripSkyLink(href: string): string {
  const url = new URL(href);
  for (const k of ["lat", "lng", "lon", "date", "time", "tz"])
    url.searchParams.delete(k);
  return url.pathname + url.search + url.hash;
}
