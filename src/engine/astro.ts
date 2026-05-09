/**
 * Heavenward — Astronomy Compute Engine
 *
 * Pure client-side ephemeris using astronomy-engine.
 * Computes rise/set/transit, altitude, azimuth, magnitude, and phase
 * for Sun, Moon, planets, and user-defined stars.
 *
 * All times are UTC internally; UI converts to local.
 */

import * as Astronomy from "astronomy-engine";
import type { GeoLocation, CelestialEvent, TwilightTimes } from "../types.js";

export type { GeoLocation, CelestialEvent, TwilightTimes } from "../types.js";

// ── Observer ───────────────────────────────────────────────────────

function makeObserver(loc: GeoLocation): Astronomy.Observer {
  return new Astronomy.Observer(loc.lat, loc.lon, loc.elev);
}

// ── Twilight ───────────────────────────────────────────────────────

export function getTwilightTimes(loc: GeoLocation, date: Date): TwilightTimes {
  const obs = makeObserver(loc);

  const Sun = Astronomy.Body.Sun;
  const sunset = Astronomy.SearchRiseSet(Sun, obs, -1, date, 1);
  const sunrise = Astronomy.SearchRiseSet(Sun, obs, +1, date, 2);

  // Civil twilight: Sun at -6°
  const civilDusk = Astronomy.SearchAltitude(Sun, obs, -1, date, 1, -6);
  const civilDawn = Astronomy.SearchAltitude(Sun, obs, +1, date, 2, -6);

  // Nautical twilight: Sun at -12°
  const nauticalDusk = Astronomy.SearchAltitude(Sun, obs, -1, date, 1, -12);
  const nauticalDawn = Astronomy.SearchAltitude(Sun, obs, +1, date, 2, -12);

  // Astronomical twilight: Sun at -18°
  const astronomicalDusk = Astronomy.SearchAltitude(Sun, obs, -1, date, 1, -18);
  const astronomicalDawn = Astronomy.SearchAltitude(Sun, obs, +1, date, 2, -18);

  let nightDurationHours = 0;
  if (astronomicalDusk && astronomicalDawn) {
    nightDurationHours =
      (astronomicalDawn.date.getTime() - astronomicalDusk.date.getTime()) /
      3_600_000;
  }

  return {
    sunset: sunset?.date ?? null,
    civilDusk: civilDusk?.date ?? null,
    nauticalDusk: nauticalDusk?.date ?? null,
    astronomicalDusk: astronomicalDusk?.date ?? null,
    astronomicalDawn: astronomicalDawn?.date ?? null,
    nauticalDawn: nauticalDawn?.date ?? null,
    civilDawn: civilDawn?.date ?? null,
    sunrise: sunrise?.date ?? null,
    nightDurationHours,
  };
}

// ── Planets ────────────────────────────────────────────────────────

const PLANETS: Astronomy.Body[] = [
  Astronomy.Body.Mercury,
  Astronomy.Body.Venus,
  Astronomy.Body.Mars,
  Astronomy.Body.Jupiter,
  Astronomy.Body.Saturn,
  Astronomy.Body.Uranus,
  Astronomy.Body.Neptune,
];

export function getPlanetEvents(
  loc: GeoLocation,
  date: Date,
): CelestialEvent[] {
  const obs = makeObserver(loc);
  return PLANETS.map((body) => {
    const rise = Astronomy.SearchRiseSet(body, obs, +1, date, 2);
    const set = Astronomy.SearchRiseSet(body, obs, -1, date, 2);
    const transit = Astronomy.SearchHourAngle(body, obs, 0, date, +1);

    const illum = Astronomy.Illumination(body, date);
    const eq = Astronomy.Equator(body, date, obs, true, true);
    const hor = Astronomy.Horizon(date, obs, eq.ra, eq.dec, "normal");
    const info = Astronomy.Constellation(eq.ra, eq.dec);

    return {
      id: `planet-${String(body).toLowerCase()}`,
      name: String(body),
      type: "planet" as const,
      source: "astronomy-engine",
      brief: `Mag ${illum.mag.toFixed(1)} in ${info.name}`,
      rise: rise?.date ?? null,
      set: set?.date ?? null,
      transit: transit?.time?.date ?? null,
      altitude: hor.altitude,
      azimuth: hor.azimuth,
      magnitude: illum.mag,
      constellation: info.name,
      illumination: illum.phase_fraction,
      ra: eq.ra,
      dec: eq.dec,
      angularSize: null,
      distanceAU: illum.geo_dist,
      extra: {
        phaseAngle: illum.phase_angle,
        helioDistAU: illum.helio_dist,
        elongation: Astronomy.AngleFromSun(body, date),
        visibility: hor.altitude > 0 ? "visible" : "below horizon",
      },
    };
  });
}

// ── Moon ───────────────────────────────────────────────────────────

export function getMoonEvent(loc: GeoLocation, date: Date): CelestialEvent {
  const obs = makeObserver(loc);
  const Moon = Astronomy.Body.Moon;
  const rise = Astronomy.SearchRiseSet(Moon, obs, +1, date, 2);
  const set = Astronomy.SearchRiseSet(Moon, obs, -1, date, 2);
  const transit = Astronomy.SearchHourAngle(Moon, obs, 0, date, +1);

  const phase = Astronomy.MoonPhase(date);
  const illum = Astronomy.Illumination(Moon, date);
  const eq = Astronomy.Equator(Moon, date, obs, true, true);
  const hor = Astronomy.Horizon(date, obs, eq.ra, eq.dec, "normal");
  const info = Astronomy.Constellation(eq.ra, eq.dec);
  const lib = Astronomy.Libration(date);

  const phaseName = getPhaseLabel(phase);

  return {
    id: "moon",
    name: "Moon",
    type: "moon",
    source: "astronomy-engine",
    brief: `${phaseName} (${(illum.phase_fraction * 100).toFixed(0)}%) in ${info.name}`,
    rise: rise?.date ?? null,
    set: set?.date ?? null,
    transit: transit?.time?.date ?? null,
    altitude: hor.altitude,
    azimuth: hor.azimuth,
    magnitude: illum.mag,
    constellation: info.name,
    illumination: illum.phase_fraction,
    ra: eq.ra,
    dec: eq.dec,
    angularSize: lib.diam_deg * 60, // to arcminutes
    distanceAU: illum.geo_dist,
    extra: {
      phaseAngle: phase,
      phaseName,
      librationLat: lib.elat,
      librationLon: lib.elon,
      distanceKm: lib.dist_km,
    },
  };
}

function getPhaseLabel(angle: number): string {
  if (angle < 22.5) return "New Moon";
  if (angle < 67.5) return "Waxing Crescent";
  if (angle < 112.5) return "First Quarter";
  if (angle < 157.5) return "Waxing Gibbous";
  if (angle < 202.5) return "Full Moon";
  if (angle < 247.5) return "Waning Gibbous";
  if (angle < 292.5) return "Third Quarter";
  if (angle < 337.5) return "Waning Crescent";
  return "New Moon";
}

// ── Upcoming Moon Quarters ─────────────────────────────────────────

export interface MoonQuarterInfo {
  quarter: string;
  date: Date;
}

export function getUpcomingMoonQuarters(
  date: Date,
  count = 4,
): MoonQuarterInfo[] {
  const labels = ["New Moon", "First Quarter", "Full Moon", "Third Quarter"];
  const results: MoonQuarterInfo[] = [];
  let mq = Astronomy.SearchMoonQuarter(date);
  for (let i = 0; i < count; i++) {
    results.push({ quarter: labels[mq.quarter], date: mq.time.date });
    mq = Astronomy.NextMoonQuarter(mq);
  }
  return results;
}

// ── Conjunctions & Oppositions ─────────────────────────────────────

export interface SpecialEvent {
  name: string;
  date: Date;
  description: string;
  type: string;
}

export function getUpcomingConjunctions(date: Date, days = 30): SpecialEvent[] {
  const events: SpecialEvent[] = [];
  const superiorPlanets: Astronomy.Body[] = [
    Astronomy.Body.Mars,
    Astronomy.Body.Jupiter,
    Astronomy.Body.Saturn,
    Astronomy.Body.Uranus,
    Astronomy.Body.Neptune,
  ];

  for (const body of superiorPlanets) {
    try {
      const opp = Astronomy.SearchRelativeLongitude(body, 0, date);
      if (opp.date.getTime() - date.getTime() < days * 86_400_000) {
        events.push({
          name: `${body} at Opposition`,
          date: opp.date,
          description: `${body} is opposite the Sun — brightest and closest to Earth`,
          type: "opposition",
        });
      }
    } catch {
      /* not found in range */
    }
  }
  return events;
}

// ── Eclipses (upcoming) ────────────────────────────────────────────

export function getUpcomingEclipses(date: Date, loc: GeoLocation) {
  const lunar = Astronomy.SearchLunarEclipse(date);
  const solar = Astronomy.SearchLocalSolarEclipse(date, makeObserver(loc));
  return { lunar, solar };
}

// ── Position of any body at a given time ───────────────────────────

export interface BodyPosition {
  altitude: number;
  azimuth: number;
  ra: number;
  dec: number;
  constellation: string;
}

export function getBodyPosition(
  body: Astronomy.Body,
  loc: GeoLocation,
  date: Date,
): BodyPosition {
  const obs = makeObserver(loc);
  const eq = Astronomy.Equator(body, date, obs, true, true);
  const hor = Astronomy.Horizon(date, obs, eq.ra, eq.dec, "normal");
  const con = Astronomy.Constellation(eq.ra, eq.dec);
  return {
    altitude: hor.altitude,
    azimuth: hor.azimuth,
    ra: eq.ra,
    dec: eq.dec,
    constellation: con.name,
  };
}

// ── Altitude for a given RA/Dec (for DSOs, arbitrary objects) ──────

export function getAltAzForRaDec(
  ra: number,
  dec: number,
  loc: GeoLocation,
  date: Date,
) {
  const obs = makeObserver(loc);
  return Astronomy.Horizon(date, obs, ra, dec, "normal");
}

// ── Rise / Set / Transit for arbitrary RA/Dec ──────────────────────

export interface RiseSetTransit {
  rise: Date | null;
  set: Date | null;
  transit: Date | null;
}

/**
 * Compute rise, set, and transit times for a fixed RA/Dec coordinate
 * over a 24-hour window starting at the given date's midnight (local).
 * Uses 5-minute stepping with binary-search refinement to ~1s accuracy.
 */
export function getRiseSetForRaDec(
  ra: number,
  dec: number,
  loc: GeoLocation,
  date: Date,
): RiseSetTransit {
  const obs = makeObserver(loc);
  const start = new Date(date);
  start.setHours(12, 0, 0, 0); // start at noon to capture tonight's window
  start.setDate(start.getDate() - 1); // from yesterday noon → today noon spans tonight

  let rise: Date | null = null;
  let set: Date | null = null;
  let transit: Date | null = null;
  let maxAlt = -Infinity;
  let prevAlt: number | null = null;

  const STEP = 5; // minutes
  const TOTAL = 36 * 60; // 36 hours to cover the full night window

  for (let m = 0; m <= TOTAL; m += STEP) {
    const t = new Date(start.getTime() + m * 60_000);
    const hor = Astronomy.Horizon(t, obs, ra, dec, "normal");

    if (hor.altitude > maxAlt) {
      maxAlt = hor.altitude;
      transit = t;
    }

    if (prevAlt !== null) {
      const prevTime = new Date(start.getTime() + (m - STEP) * 60_000);
      if (prevAlt <= 0 && hor.altitude > 0 && !rise) {
        rise = refineAltCrossing(obs, ra, dec, prevTime, t, true);
      }
      if (prevAlt > 0 && hor.altitude <= 0 && !set) {
        set = refineAltCrossing(obs, ra, dec, prevTime, t, false);
      }
    }
    prevAlt = hor.altitude;
  }

  return { rise, set, transit };
}

function refineAltCrossing(
  obs: Astronomy.Observer,
  ra: number,
  dec: number,
  t1: Date,
  t2: Date,
  rising: boolean,
): Date {
  for (let i = 0; i < 16; i++) {
    const mid = new Date((t1.getTime() + t2.getTime()) / 2);
    const hor = Astronomy.Horizon(mid, obs, ra, dec, "normal");
    if (rising) {
      if (hor.altitude > 0) t2 = mid;
      else t1 = mid;
    } else {
      if (hor.altitude > 0) t1 = mid;
      else t2 = mid;
    }
  }
  return new Date((t1.getTime() + t2.getTime()) / 2);
}

// ── Direction helpers ──────────────────────────────────────────────

const COMPASS_16 = [
  "north", "north-northeast", "northeast", "east-northeast",
  "east", "east-southeast", "southeast", "south-southeast",
  "south", "south-southwest", "southwest", "west-southwest",
  "west", "west-northwest", "northwest", "north-northwest",
] as const;

export function azimuthToCompass(az: number): string {
  const i = Math.round(((az % 360) + 360) % 360 / 22.5) % 16;
  return COMPASS_16[i];
}

export function azimuthToCompassShort(az: number): string {
  const shorts = [
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
  ];
  const i = Math.round(((az % 360) + 360) % 360 / 22.5) % 16;
  return shorts[i];
}

export function altitudeDescription(alt: number): string {
  if (alt < 0) return "below the horizon";
  if (alt < 10) return "very low on the horizon";
  if (alt < 25) return "low in the sky";
  if (alt < 45) return "about a third of the way up";
  if (alt < 65) return "high in the sky";
  if (alt < 80) return "very high, nearly overhead";
  return "nearly straight overhead";
}

// ── Angular separation ────────────────────────────────────────────

/**
 * Compute angular separation in degrees between two RA/Dec positions.
 * RA in hours, Dec in degrees.
 */
export function angularSeparation(
  ra1: number,
  dec1: number,
  ra2: number,
  dec2: number,
): number {
  const toRad = Math.PI / 180;
  const ra1r = ra1 * 15 * toRad;
  const ra2r = ra2 * 15 * toRad;
  const dec1r = dec1 * toRad;
  const dec2r = dec2 * toRad;

  const cosD =
    Math.sin(dec1r) * Math.sin(dec2r) +
    Math.cos(dec1r) * Math.cos(dec2r) * Math.cos(ra1r - ra2r);
  return Math.acos(Math.min(1, Math.max(-1, cosD))) / toRad;
}

// ── Sidereal time (for chart rendering) ────────────────────────────

export function getSiderealTime(date: Date): number {
  return Astronomy.SiderealTime(date);
}
