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

/** Current Sun altitude in degrees (positive = above horizon) */
export function getSunAltitude(loc: GeoLocation, date: Date): number {
  const obs = makeObserver(loc);
  const eq = Astronomy.Equator(Astronomy.Body.Sun, date, obs, true, true);
  const hor = Astronomy.Horizon(date, obs, eq.ra, eq.dec, "normal");
  return hor.altitude;
}

function before(date: Date, hours: number): Date {
  return new Date(date.getTime() - hours * 3_600_000);
}

function pairedSunset(
  obs: Astronomy.Observer,
  sunrise: Astronomy.AstroTime | null,
  date: Date,
): Astronomy.AstroTime | null {
  const anchor = sunrise?.date ?? new Date(date.getTime() + 24 * 3_600_000);
  return Astronomy.SearchRiseSet(
    Astronomy.Body.Sun,
    obs,
    -1,
    before(anchor, 24),
    2,
  );
}

function pairedDusk(
  obs: Astronomy.Observer,
  dawn: Astronomy.AstroTime | null,
  date: Date,
  altitude: number,
): Astronomy.AstroTime | null {
  const anchor = dawn?.date ?? new Date(date.getTime() + 24 * 3_600_000);
  return Astronomy.SearchAltitude(
    Astronomy.Body.Sun,
    obs,
    -1,
    before(anchor, 24),
    2,
    altitude,
  );
}

export function getTwilightTimes(loc: GeoLocation, date: Date): TwilightTimes {
  const obs = makeObserver(loc);

  const Sun = Astronomy.Body.Sun;
  const sunrise = Astronomy.SearchRiseSet(Sun, obs, +1, date, 2);
  const sunset = pairedSunset(obs, sunrise, date);

  // Civil twilight: Sun at -6°
  const civilDawn = Astronomy.SearchAltitude(Sun, obs, +1, date, 2, -6);
  const civilDusk = pairedDusk(obs, civilDawn, date, -6);

  // Nautical twilight: Sun at -12°
  const nauticalDawn = Astronomy.SearchAltitude(Sun, obs, +1, date, 2, -12);
  const nauticalDusk = pairedDusk(obs, nauticalDawn, date, -12);

  // Astronomical twilight: Sun at -18°
  const astronomicalDawn = Astronomy.SearchAltitude(Sun, obs, +1, date, 2, -18);
  const astronomicalDusk = pairedDusk(obs, astronomicalDawn, date, -18);

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
        sourceKey: "planets",
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
      sourceKey: "moon",
      phaseAngle: phase,
      phaseName,
      librationLat: lib.elat,
      librationLon: lib.elon,
      distanceKm: lib.dist_km,
    },
  };
}

/** Phase name and illuminated fraction only — the cheap subset of
 *  getMoonEvent for callers that need "what kind of observing night is
 *  this" rather than a full ephemeris. */
export function getMoonSummary(date: Date): {
  phaseName: string;
  illumination: number;
} {
  const phase = Astronomy.MoonPhase(date);
  const illum = Astronomy.Illumination(Astronomy.Body.Moon, date);
  return {
    phaseName: getPhaseLabel(phase),
    illumination: illum.phase_fraction,
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

// ── Tonight's rise and set (night window) ─────────────────────────

/** Tonight, from sunset to the following sunrise. */
export interface NightWindow {
  start: Date;
  end: Date;
}

/**
 * The night `at` belongs to: the sunset before the next sunrise, through
 * that sunrise. At 2 pm that is tonight; at 3 am it is the night in
 * progress. Where the Sun does not set or rise (polar day or night) it falls
 * back to the 12 hours from `at`.
 */
export function getNightWindow(loc: GeoLocation, at: Date): NightWindow {
  const tw = getTwilightTimes(loc, at);
  if (tw.sunset && tw.sunrise && tw.sunrise > tw.sunset) {
    return { start: tw.sunset, end: tw.sunrise };
  }
  return { start: at, end: new Date(at.getTime() + 12 * 3_600_000) };
}

export type NightState =
  /** Crosses the horizon at least once tonight (see `events`). */
  | "rises-sets"
  /** Circumpolar at this latitude: never sets. */
  | "always-up"
  /** Never clears the horizon at this latitude. */
  | "never-rises"
  /** Above the horizon for the whole night, though not circumpolar. */
  | "up-all-night"
  /** Below the horizon for the whole night, though it does rise some time. */
  | "down-all-night";

export interface NightRiseSet {
  state: NightState;
  /** Tonight's first rise inside the window, if any. */
  rise: Date | null;
  /** Tonight's first set inside the window, if any. */
  set: Date | null;
  /** Highest point inside the window. */
  peak: Date | null;
  /** Every horizon crossing inside the window, in time order. */
  events: { kind: "rise" | "set"; at: Date }[];
}

/** Circumpolar or never-rises for a fixed declination (geometric horizon). */
function polarState(lat: number, dec: number): NightState | null {
  if (lat >= 0) {
    if (dec > 90 - lat) return "always-up";
    if (dec < lat - 90) return "never-rises";
  } else {
    if (dec < -90 - lat) return "always-up";
    if (dec > 90 + lat) return "never-rises";
  }
  return null;
}

function summarise(
  events: { kind: "rise" | "set"; at: Date }[],
  upAtStart: boolean,
  peak: Date | null,
  polar: NightState | null,
): NightRiseSet {
  events.sort((a, b) => a.at.getTime() - b.at.getTime());
  const state: NightState =
    polar ??
    (events.length
      ? "rises-sets"
      : upAtStart
        ? "up-all-night"
        : "down-all-night");
  return {
    state,
    rise: events.find((e) => e.kind === "rise")?.at ?? null,
    set: events.find((e) => e.kind === "set")?.at ?? null,
    peak,
    events: polar ? [] : events,
  };
}

/**
 * Rise and set of a fixed RA/Dec inside tonight's window, in the order they
 * happen. Unlike getRiseSetForRaDec (first crossings anywhere in 36 hours
 * from the device's yesterday noon) this only reports what happens tonight,
 * and says when an object is circumpolar or never rises.
 */
export function getNightRiseSetForRaDec(
  ra: number,
  dec: number,
  loc: GeoLocation,
  night: NightWindow,
): NightRiseSet {
  const obs = makeObserver(loc);
  const polar = polarState(loc.lat, dec);
  const startMs = night.start.getTime();
  const endMs = night.end.getTime();
  const STEP = 10 * 60_000;
  const events: { kind: "rise" | "set"; at: Date }[] = [];
  let peak: Date | null = null;
  let peakAlt = -Infinity;
  let prevAlt: number | null = null;
  let prevT = startMs;
  let upAtStart = false;
  for (let ms = startMs; ; ms = Math.min(ms + STEP, endMs)) {
    const t = new Date(ms);
    const alt = Astronomy.Horizon(t, obs, ra, dec, "normal").altitude;
    if (prevAlt === null) upAtStart = alt > 0;
    if (alt > peakAlt) {
      peakAlt = alt;
      peak = t;
    }
    if (prevAlt !== null && !polar) {
      if (prevAlt <= 0 && alt > 0) {
        events.push({ kind: "rise", at: refineAltCrossing(obs, ra, dec, new Date(prevT), t, true) });
      } else if (prevAlt > 0 && alt <= 0) {
        events.push({ kind: "set", at: refineAltCrossing(obs, ra, dec, new Date(prevT), t, false) });
      }
    }
    prevAlt = alt;
    prevT = ms;
    if (ms >= endMs) break;
  }
  return summarise(events, upAtStart, peak, polar);
}

/** The same for a Solar System body (planets, the Moon). */
export function getNightRiseSetForBody(
  body: Astronomy.Body,
  loc: GeoLocation,
  night: NightWindow,
): NightRiseSet {
  const obs = makeObserver(loc);
  const days = (night.end.getTime() - night.start.getTime()) / 86_400_000;
  const events: { kind: "rise" | "set"; at: Date }[] = [];
  for (const [dir, kind] of [[+1, "rise"], [-1, "set"]] as const) {
    let from = night.start;
    // At most two crossings of each kind fit in a night.
    for (let i = 0; i < 2; i++) {
      const left = (night.end.getTime() - from.getTime()) / 86_400_000;
      if (left <= 0) break;
      const hit = Astronomy.SearchRiseSet(body, obs, dir, from, Math.min(left, days));
      if (!hit || hit.date > night.end) break;
      events.push({ kind, at: hit.date });
      from = new Date(hit.date.getTime() + 60_000);
    }
  }
  const altAt = (t: Date) => {
    const eq = Astronomy.Equator(body, t, obs, true, true);
    return Astronomy.Horizon(t, obs, eq.ra, eq.dec, "normal").altitude;
  };
  const transit = Astronomy.SearchHourAngle(body, obs, 0, night.start, +1);
  const peak =
    transit.time.date <= night.end
      ? transit.time.date
      : altAt(night.start) >= altAt(night.end)
        ? night.start
        : night.end;
  return summarise(events, altAt(night.start) > 0, peak, null);
}

/** getNightRiseSetForBody by name ("Jupiter", "Moon"); null if unknown. */
export function getNightRiseSetForBodyName(
  name: string,
  loc: GeoLocation,
  night: NightWindow,
): NightRiseSet | null {
  const body = (Object.values(Astronomy.Body) as string[]).find(
    (b) => b.toLowerCase() === name.toLowerCase(),
  ) as Astronomy.Body | undefined;
  return body ? getNightRiseSetForBody(body, loc, night) : null;
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
  "north",
  "north-northeast",
  "northeast",
  "east-northeast",
  "east",
  "east-southeast",
  "southeast",
  "south-southeast",
  "south",
  "south-southwest",
  "southwest",
  "west-southwest",
  "west",
  "west-northwest",
  "northwest",
  "north-northwest",
] as const;

export function azimuthToCompass(az: number): string {
  const i = Math.round((((az % 360) + 360) % 360) / 22.5) % 16;
  return COMPASS_16[i];
}

export function azimuthToCompassShort(az: number): string {
  const shorts = [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSW",
    "SW",
    "WSW",
    "W",
    "WNW",
    "NW",
    "NNW",
  ];
  const i = Math.round((((az % 360) + 360) % 360) / 22.5) % 16;
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
