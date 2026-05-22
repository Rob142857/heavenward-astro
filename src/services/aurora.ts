import type { GeoLocation } from "../types.js";

/* ── NOAA Space Weather aurora service ────────────────────────────
 *
 * Three live JSON feeds from NOAA SWPC (CORS-enabled, no auth):
 *   1. Planetary K-index (current observed Kp, 3h cadence)
 *   2. Planetary K-index 3-day forecast
 *   3. OVATION Prime aurora oval (1\u00b0 grid of probability %)
 *
 * Results are cached in sessionStorage for 30 minutes \u2014 a single fetch
 * per session is plenty, and the underlying data updates every 30\u201360 min
 * anyway.
 *
 * "Tonight relevance": we surface aurora context only when there is a
 * meaningful chance of seeing it from the user's latitude. Quiet sub-auroral
 * activity at Kp 2 from London is noise; a Kp 6 storm with 8% local
 * probability is genuinely worth telling the user about.
 */

const KP_URL =
  "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json";
const KP_FORECAST_URL =
  "https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json";
const OVATION_URL =
  "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json";

const CACHE_KEY = "heavenward.aurora.v1";
const CACHE_TTL_MS = 30 * 60 * 1000;

export interface AuroraStatus {
  /** Most recent observed Kp index (0\u20139). */
  currentKp: number;
  /** Peak forecast Kp in the next 72 hours. */
  forecastPeakKp: number;
  /** ISO timestamp of the forecast peak (UTC). */
  forecastPeakAt: string;
  /** NOAA G-scale label for the forecast peak (e.g. "G1 Minor"). */
  stormLevel: string | null;
  /** OVATION probability % at the viewer's location (0\u2013100). */
  localProbability: number;
  /** Best probability % anywhere on the user's longitude (north or south). */
  hemisphereBest: number;
  /** Last fetched, ISO UTC. */
  fetchedAt: string;
  /** True when this report meaningfully deserves UI surface area. */
  worthSurfacing: boolean;
}

interface CachedReport {
  fetchedAtMs: number;
  status: AuroraStatus;
}

/* ── Public API ───────────────────────────────────────────────── */

export async function fetchAuroraStatus(
  loc: GeoLocation,
): Promise<AuroraStatus | null> {
  const cached = readCache(loc);
  if (cached) return cached;

  try {
    const [kpNow, kpFc, ovation] = await Promise.all([
      fetchKpCurrent(),
      fetchKpForecast(),
      fetchOvation(),
    ]);

    const localProbability = ovation
      ? probabilityAt(ovation, loc.lat, loc.lon)
      : 0;
    const hemisphereBest = ovation
      ? bestAlongLongitude(ovation, loc.lon)
      : 0;

    const status: AuroraStatus = {
      currentKp: kpNow ?? 0,
      forecastPeakKp: kpFc?.peakKp ?? kpNow ?? 0,
      forecastPeakAt: kpFc?.peakAt ?? new Date().toISOString(),
      stormLevel: stormLabel(kpFc?.peakKp ?? kpNow ?? 0),
      localProbability,
      hemisphereBest,
      fetchedAt: new Date().toISOString(),
      worthSurfacing: shouldSurface(
        kpNow ?? 0,
        kpFc?.peakKp ?? 0,
        localProbability,
        loc.lat,
      ),
    };
    writeCache(loc, status);
    return status;
  } catch {
    return null;
  }
}

/* ── NOAA endpoints ───────────────────────────────────────────── */

async function fetchKpCurrent(): Promise<number | null> {
  const res = await fetch(KP_URL, { cache: "no-store" });
  if (!res.ok) return null;
  const rows = (await res.json()) as unknown;
  if (!Array.isArray(rows) || rows.length < 2) return null;
  // Header row first; subsequent rows are [time_tag, kp, a_running, station_count]
  const last = rows[rows.length - 1];
  if (!Array.isArray(last) || last.length < 2) return null;
  const kp = Number(last[1]);
  return Number.isFinite(kp) ? kp : null;
}

interface KpForecastPeak {
  peakKp: number;
  peakAt: string;
}

async function fetchKpForecast(): Promise<KpForecastPeak | null> {
  const res = await fetch(KP_FORECAST_URL, { cache: "no-store" });
  if (!res.ok) return null;
  const rows = (await res.json()) as unknown;
  if (!Array.isArray(rows) || rows.length < 2) return null;
  let peakKp = -1;
  let peakAt = "";
  const horizon = Date.now() + 72 * 3600 * 1000;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row) || row.length < 2) continue;
    const t = String(row[0]).replace(" ", "T") + "Z";
    const ms = Date.parse(t);
    if (!Number.isFinite(ms) || ms > horizon) continue;
    const kp = Number(row[1]);
    if (Number.isFinite(kp) && kp > peakKp) {
      peakKp = kp;
      peakAt = new Date(ms).toISOString();
    }
  }
  return peakKp >= 0 ? { peakKp, peakAt } : null;
}

interface OvationGrid {
  coordinates: number[][]; // [lon 0..359, lat -90..90, prob 0..100]
}

async function fetchOvation(): Promise<OvationGrid | null> {
  const res = await fetch(OVATION_URL, { cache: "no-store" });
  if (!res.ok) return null;
  const json = (await res.json()) as unknown;
  if (
    typeof json !== "object" ||
    json === null ||
    !("coordinates" in json) ||
    !Array.isArray((json as { coordinates: unknown }).coordinates)
  ) {
    return null;
  }
  return json as OvationGrid;
}

/* ── Probability lookup ───────────────────────────────────────── */

function probabilityAt(grid: OvationGrid, lat: number, lon: number): number {
  // OVATION grid is 1\u00b0 resolution, longitudes 0\u2013359, latitudes -90\u201390.
  // Nearest-neighbour is sufficient given the grid step.
  const lonN = ((Math.round(lon) % 360) + 360) % 360;
  const latN = Math.max(-90, Math.min(90, Math.round(lat)));
  // The published payload is a flat list; linear scan is fast (~64k entries).
  for (const cell of grid.coordinates) {
    if (cell[0] === lonN && cell[1] === latN) {
      return Number(cell[2]) || 0;
    }
  }
  return 0;
}

function bestAlongLongitude(grid: OvationGrid, lon: number): number {
  const lonN = ((Math.round(lon) % 360) + 360) % 360;
  let best = 0;
  for (const cell of grid.coordinates) {
    if (cell[0] === lonN) {
      const p = Number(cell[2]) || 0;
      if (p > best) best = p;
    }
  }
  return best;
}

/* ── Helpers ──────────────────────────────────────────────────── */

function stormLabel(kp: number): string | null {
  if (kp >= 9) return "G5 Extreme";
  if (kp >= 8) return "G4 Severe";
  if (kp >= 7) return "G3 Strong";
  if (kp >= 6) return "G2 Moderate";
  if (kp >= 5) return "G1 Minor";
  return null;
}

/**
 * Decide whether to put aurora context in front of the user.
 *
 * Aurora is visible far further south than most people realise during storms
 * \u2014 the geomagnetic pole is offset from the geographic pole, so e.g. a Kp 7
 * event lights up skies as far south as ~45\u00b0N geographic latitude. We surface
 * the card whenever any of the following is true:
 *   \u2022 Local OVATION probability \u2265 3% (a meaningful chance at this very spot)
 *   \u2022 Forecast peak Kp \u2265 5 and the viewer is at |lat| \u2265 35\u00b0
 *   \u2022 Current Kp \u2265 4 and the viewer is at |lat| \u2265 45\u00b0
 */
function shouldSurface(
  kpNow: number,
  kpPeak: number,
  localProb: number,
  lat: number,
): boolean {
  const absLat = Math.abs(lat);
  if (localProb >= 3) return true;
  if (kpPeak >= 5 && absLat >= 35) return true;
  if (kpNow >= 4 && absLat >= 45) return true;
  return false;
}

/* ── Cache ────────────────────────────────────────────────────── */

function cacheKey(loc: GeoLocation): string {
  return `${CACHE_KEY}:${loc.lat.toFixed(1)}:${loc.lon.toFixed(1)}`;
}

function readCache(loc: GeoLocation): AuroraStatus | null {
  try {
    const raw = sessionStorage.getItem(cacheKey(loc));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedReport;
    if (Date.now() - parsed.fetchedAtMs > CACHE_TTL_MS) return null;
    return parsed.status;
  } catch {
    return null;
  }
}

function writeCache(loc: GeoLocation, status: AuroraStatus): void {
  try {
    const payload: CachedReport = { fetchedAtMs: Date.now(), status };
    sessionStorage.setItem(cacheKey(loc), JSON.stringify(payload));
  } catch {
    // sessionStorage may be unavailable in private mode \u2014 fine, fall through.
  }
}
