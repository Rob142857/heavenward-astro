// The four read-only MCP tools. They reuse src/engine, so every number
// matches what the app shows for the same place and night.
import * as Astronomy from "astronomy-engine";
import {
  angularSeparation,
  getAltAzForRaDec,
  getBodyPosition,
  getMoonSummary,
  getNightRiseSetForBody,
  getNightRiseSetForRaDec,
  getNightWindow,
  getTwilightTimes,
  type NightRiseSet,
  type NightWindow,
} from "../../src/engine/astro.ts";
import { hoursInWindow, summariseHours, type CloudForecast } from "../../src/engine/cloud.ts";
import { catalogKey, normalizeText } from "../../src/services/search-core.ts";
import type { GeoLocation } from "../../src/types.ts";

export const MAX_TARGETS = 20;
export const MAX_NIGHTS = 3;
const STEP_MIN = 15;

// Seestar S30 Pro: Sony IMX585 (3840 x 2160, 2.9 um) behind a 160 mm lens:
// 3840 * 2.9 um / 160 mm = 3.99 deg, 2160 * 2.9 um / 160 mm = 2.24 deg.
export const S30PRO = { longArcmin: 239, shortArcmin: 135, arcsecPerPx: 3.74 };

export class ToolError extends Error {}

// ── Catalogue ────────────────────────────────────────────

/** Row of dist/mcp-catalog.json (scripts/build-mcp-catalog.ts). */
export type CatalogRow = [
  string, string, string, string[], string,
  number, number, number | null, number | null, number | null, number | null,
];

export interface Target {
  id: string;
  name: string;
  kind: string;
  ra?: number;
  dec?: number;
  mag?: number | null;
  sizeArcmin?: number | null;
  minorArcmin?: number | null;
  positionAngle?: number | null;
  body?: Astronomy.Body;
}

const BODIES: Astronomy.Body[] = [
  Astronomy.Body.Moon, Astronomy.Body.Mercury, Astronomy.Body.Venus, Astronomy.Body.Mars,
  Astronomy.Body.Jupiter, Astronomy.Body.Saturn, Astronomy.Body.Uranus, Astronomy.Body.Neptune,
  Astronomy.Body.Pluto,
];

export class Catalog {
  private index = new Map<string, Target>();
  private names: string[] = [];

  constructor(rows: CatalogRow[]) {
    for (const [id, name, common, aliases, kind, ra, dec, mag, size, minor, pa] of rows) {
      const t: Target = { id, name: common ? `${name} (${common})` : name, kind, ra, dec, mag, sizeArcmin: size, minorArcmin: minor, positionAngle: pa };
      for (const k of [id, name, common, ...aliases]) this.add(k, t);
    }
    for (const b of BODIES) this.add(b, { id: b.toLowerCase(), name: b, kind: b === "Moon" ? "moon" : "planet", body: b });
  }

  private add(label: string, t: Target) {
    if (!label) return;
    const key = catalogKey(label) ?? normalizeText(label);
    if (!key || this.index.has(key)) return; // first (DSO before star) wins
    this.index.set(key, t);
    this.names.push(key);
  }

  find(q: string): Target | null {
    const key = catalogKey(q) ?? normalizeText(q);
    return key ? (this.index.get(key) ?? null) : null;
  }

  /** Up to 3 near names for a miss. */
  suggest(q: string): string[] {
    const n = normalizeText(q);
    if (n.length < 2) return [];
    return this.names.filter((k) => k.startsWith(n) || k.includes(` ${n}`)).slice(0, 3);
  }
}

// ── Input checks ─────────────────────────────────────────

type Args = Record<string, unknown>;

function num(a: Args, k: string, min: number, max: number): number {
  const v = a[k];
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) {
    throw new ToolError(`${k} must be a number from ${min} to ${max}`);
  }
  return v;
}

function location(a: Args): GeoLocation {
  return { lat: num(a, "lat", -90, 90), lon: num(a, "lon", -180, 180), elev: 0 };
}

function nightsArg(a: Args): number {
  return a.nights === undefined ? 1 : Math.round(num(a, "nights", 1, MAX_NIGHTS));
}

function timeZone(a: Args): string | undefined {
  if (a.tz === undefined) return undefined;
  if (typeof a.tz !== "string") throw new ToolError("tz must be an IANA zone like Australia/Sydney");
  try {
    new Intl.DateTimeFormat("en-AU", { timeZone: a.tz });
  } catch {
    throw new ToolError(`unknown tz: ${a.tz}`);
  }
  return a.tz;
}

/** Local solar noon on `date` (YYYY-MM-DD, default today), so getNightWindow picks that evening. */
function startDate(a: Args, loc: GeoLocation, now: number): Date {
  let day: number;
  if (a.date === undefined) {
    day = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  } else {
    if (typeof a.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(a.date)) throw new ToolError("date must be YYYY-MM-DD");
    day = Date.parse(`${a.date}T00:00:00Z`);
    if (!Number.isFinite(day)) throw new ToolError("date must be YYYY-MM-DD");
    if (Math.abs(day - now) > 366 * 86_400_000) throw new ToolError("date must be within a year of today");
  }
  return new Date(day + (12 - loc.lon / 15) * 3_600_000);
}

function nightsFrom(a: Args, loc: GeoLocation, now: number): NightWindow[] {
  const start = startDate(a, loc, now);
  const out: NightWindow[] = [];
  for (let i = 0; i < nightsArg(a); i++) out.push(getNightWindow(loc, new Date(start.getTime() + i * 86_400_000)));
  return out;
}

function targetsArg(a: Args, cat: Catalog, max = MAX_TARGETS): { found: Target[]; missing: { query: string; suggestions: string[] }[] } {
  const v = a.targets;
  if (!Array.isArray(v) || v.length === 0 || v.some((x) => typeof x !== "string" || x.length > 80)) {
    throw new ToolError("targets must be a list of names, e.g. [\"M42\", \"Jupiter\", \"Carina Nebula\"]");
  }
  if (v.length > max) throw new ToolError(`at most ${max} targets per call`);
  const found: Target[] = [];
  const missing: { query: string; suggestions: string[] }[] = [];
  for (const q of v as string[]) {
    const t = cat.find(q);
    if (t) found.push(t);
    else missing.push({ query: q, suggestions: cat.suggest(q) });
  }
  return { found, missing };
}

// ── Formatting ───────────────────────────────────────────

const r1 = (n: number) => Math.round(n * 10) / 10;

function when(d: Date | null, tz?: string): string | null {
  if (!d) return null;
  const iso = d.toISOString().slice(0, 16) + "Z";
  if (!tz) return iso;
  const local = new Intl.DateTimeFormat("en-AU", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return `${iso} (${local})`;
}

function altAz(t: Target, loc: GeoLocation, at: Date): { alt: number; az: number; ra: number; dec: number } {
  if (t.body) {
    const p = getBodyPosition(t.body, loc, at);
    return { alt: p.altitude, az: p.azimuth, ra: p.ra, dec: p.dec };
  }
  const h = getAltAzForRaDec(t.ra!, t.dec!, loc, at);
  return { alt: h.altitude, az: h.azimuth, ra: t.ra!, dec: t.dec! };
}

function riseSet(t: Target, loc: GeoLocation, night: NightWindow): NightRiseSet {
  return t.body ? getNightRiseSetForBody(t.body, loc, night) : getNightRiseSetForRaDec(t.ra!, t.dec!, loc, night);
}

function header(t: Target) {
  return {
    target: t.name,
    id: t.id,
    kind: t.kind,
    ...(t.mag != null ? { magnitude: t.mag } : {}),
    ...(t.sizeArcmin != null ? { size_arcmin: t.sizeArcmin } : {}),
  };
}

// ── Tools ────────────────────────────────────────────────

export interface ToolDeps {
  catalog: () => Promise<Catalog>;
  forecast: (lat: number, lon: number) => Promise<CloudForecast | null>;
  now: () => number;
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: object;
  run: (args: Args, deps: ToolDeps) => Promise<unknown>;
  /** How many targets the call asked about (for the audit row). */
  count: (args: Args) => number;
}

const LATLON = {
  lat: { type: "number", minimum: -90, maximum: 90, description: "Observer latitude, degrees (south is negative)" },
  lon: { type: "number", minimum: -180, maximum: 180, description: "Observer longitude, degrees (west is negative)" },
};
const DATE = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "Evening date at the site, YYYY-MM-DD. Default: today (UTC)." };
const NIGHTS = { type: "integer", minimum: 1, maximum: MAX_NIGHTS, description: `Nights starting from date (1 to ${MAX_NIGHTS}). Default 1.` };
const TZ = { type: "string", description: "Optional IANA time zone (e.g. Australia/Sydney) to add local times." };
const TARGETS = {
  type: "array",
  items: { type: "string" },
  minItems: 1,
  maxItems: MAX_TARGETS,
  description: "Targets by name or catalogue id: Messier/NGC/IC/Caldwell ids, common names (\"Orion Nebula\"), star names, planets, Moon.",
};
const countTargets = (a: Args) => (Array.isArray(a.targets) ? a.targets.length : 0);

export const TOOLS: ToolDef[] = [
  {
    name: "sky_targets_altaz",
    title: "Target altitude through the night",
    description:
      "Altitude and azimuth every 15 minutes from sunset to sunrise for each target, with tonight's rise, set and highest point, and the best time to observe (highest point during full darkness). Same engine as the Heavenward app.",
    inputSchema: { type: "object", properties: { targets: TARGETS, ...LATLON, date: DATE, nights: NIGHTS, tz: TZ }, required: ["targets", "lat", "lon"], additionalProperties: false },
    count: countTargets,
    async run(a, deps) {
      const loc = location(a);
      const tz = timeZone(a);
      const nights = nightsFrom(a, loc, deps.now());
      const { found, missing } = targetsArg(a, await deps.catalog());
      return {
        nights: nights.map((night) => {
          const tw = getTwilightTimes(loc, new Date(night.start.getTime() + 3_600_000));
          const darkFrom = tw.astronomicalDusk?.getTime() ?? night.start.getTime();
          const darkTo = tw.astronomicalDawn?.getTime() ?? night.end.getTime();
          return {
            sunset: when(night.start, tz),
            sunrise: when(night.end, tz),
            targets: found.map((t) => {
              const samples: { t: string | null; alt: number; az: number }[] = [];
              let best: { at: number; alt: number; az: number } | null = null;
              let minutesAbove30 = 0;
              for (let ms = night.start.getTime(); ms <= night.end.getTime(); ms += STEP_MIN * 60_000) {
                const p = altAz(t, loc, new Date(ms));
                samples.push({ t: when(new Date(ms), tz), alt: r1(p.alt), az: r1(p.az) });
                if (p.alt >= 30) minutesAbove30 += STEP_MIN;
                if (ms >= darkFrom && ms <= darkTo && p.alt > 0 && (!best || p.alt > best.alt)) best = { at: ms, alt: p.alt, az: p.az };
              }
              const rs = riseSet(t, loc, night);
              return {
                ...header(t),
                state: rs.state,
                rise: when(rs.rise, tz),
                set: when(rs.set, tz),
                highest: when(rs.peak, tz),
                best_dark_time: best ? { t: when(new Date(best.at), tz), alt: r1(best.alt), az: r1(best.az) } : null,
                hours_above_30deg: r1(minutesAbove30 / 60),
                samples,
              };
            }),
          };
        }),
        not_found: missing,
      };
    },
  },
  {
    name: "sky_night_window",
    title: "Darkness and Moon for the night",
    description:
      "Sunset, civil/nautical/astronomical dusk and dawn, sunrise, hours of full darkness, Moon rise/set, phase and illumination, and (optionally) each target's distance from the Moon at midnight.",
    inputSchema: {
      type: "object",
      properties: { ...LATLON, date: DATE, nights: NIGHTS, tz: TZ, targets: { ...TARGETS, description: "Optional targets to measure Moon separation for." } },
      required: ["lat", "lon"],
      additionalProperties: false,
    },
    count: countTargets,
    async run(a, deps) {
      const loc = location(a);
      const tz = timeZone(a);
      const nights = nightsFrom(a, loc, deps.now());
      const { found, missing } = a.targets === undefined ? { found: [], missing: [] } : targetsArg(a, await deps.catalog());
      return {
        nights: nights.map((night) => {
          const tw = getTwilightTimes(loc, new Date(night.start.getTime() + 3_600_000));
          const mid = new Date((night.start.getTime() + night.end.getTime()) / 2);
          const moonRs = getNightRiseSetForBody(Astronomy.Body.Moon, loc, night);
          const moon = getMoonSummary(mid);
          const moonPos = getBodyPosition(Astronomy.Body.Moon, loc, mid);
          const darkHours =
            tw.astronomicalDusk && tw.astronomicalDawn && tw.astronomicalDawn > tw.astronomicalDusk
              ? (tw.astronomicalDawn.getTime() - tw.astronomicalDusk.getTime()) / 3_600_000
              : 0;
          return {
            sunset: when(tw.sunset, tz),
            civil_dusk: when(tw.civilDusk, tz),
            nautical_dusk: when(tw.nauticalDusk, tz),
            astronomical_dusk: when(tw.astronomicalDusk, tz),
            astronomical_dawn: when(tw.astronomicalDawn, tz),
            nautical_dawn: when(tw.nauticalDawn, tz),
            civil_dawn: when(tw.civilDawn, tz),
            sunrise: when(tw.sunrise, tz),
            dark_hours: r1(darkHours),
            moon: {
              phase: moon.phaseName,
              illumination_pct: Math.round(moon.illumination * 100),
              state: moonRs.state,
              rise: when(moonRs.rise, tz),
              set: when(moonRs.set, tz),
              alt_at_midnight: r1(moonPos.altitude),
            },
            moon_separation_deg: found.map((t) => {
              const p = altAz(t, loc, mid);
              return { target: t.name, deg: r1(angularSeparation(p.ra, p.dec, moonPos.ra, moonPos.dec)) };
            }),
          };
        }),
        not_found: missing,
      };
    },
  },
  {
    name: "sky_weather",
    title: "Cloud forecast",
    description:
      "Hourly cloud cover (low, mid, high, total, %) and visibility for the next 2 days at a site, the same Open-Meteo forecast the app's cloud view uses, plus a verdict for tonight's dark hours. Weather data by Open-Meteo.com (CC BY 4.0).",
    inputSchema: { type: "object", properties: { ...LATLON, tz: TZ }, required: ["lat", "lon"], additionalProperties: false },
    count: () => 0,
    async run(a, deps) {
      const loc = location(a);
      const tz = timeZone(a);
      const fc = await deps.forecast(loc.lat, loc.lon);
      if (!fc) throw new ToolError("forecast unavailable right now, try again shortly");
      const night = getNightWindow(loc, new Date(deps.now()));
      const tonight = summariseHours(hoursInWindow(fc, night.start.getTime(), night.end.getTime()));
      return {
        attribution: "Weather data by Open-Meteo.com (CC BY 4.0)",
        grid_cell: fc.cell,
        fetched_at: new Date(fc.fetchedAt).toISOString(),
        tonight: { from: when(night.start, tz), to: when(night.end, tz), summary: tonight },
        hours: fc.t.map((t, i) => ({
          t: when(new Date(t), tz),
          total: fc.total[i],
          low: fc.low[i],
          mid: fc.mid[i],
          high: fc.high[i],
          visibility_m: fc.vis[i],
        })),
      };
    },
  },
  {
    name: "seestar_s30pro_framing",
    title: "Seestar S30 Pro framing",
    description:
      "Does each target fit the Seestar S30 Pro frame (about 239 x 135 arcmin, 3.74 arcsec per pixel)? Gives how much of the frame it fills, the best frame rotation to line its long axis up with the frame's long side, and a mosaic size when it does not fit.",
    inputSchema: { type: "object", properties: { targets: TARGETS }, required: ["targets"], additionalProperties: false },
    count: countTargets,
    async run(a, deps) {
      const { found, missing } = targetsArg(a, await deps.catalog());
      return {
        frame: { long_arcmin: S30PRO.longArcmin, short_arcmin: S30PRO.shortArcmin, arcsec_per_px: S30PRO.arcsecPerPx },
        targets: found.map((t) => ({ ...header(t), ...framing(t, deps.now()) })),
        not_found: missing,
      };
    },
  },
];

/** Framing advice for one target in the S30 Pro field. */
export function framing(t: Target, now: number) {
  let major = t.sizeArcmin ?? null;
  let minor = t.minorArcmin ?? major;
  if (t.body) {
    // Apparent diameter from distance: Moon 3474 km; planets from their own radius.
    const radiusKm: Record<string, number> = { Moon: 1737.4, Mercury: 2439.7, Venus: 6051.8, Mars: 3389.5, Jupiter: 69911, Saturn: 58232, Uranus: 25362, Neptune: 24622, Pluto: 1188 };
    const au = Astronomy.GeoVector(t.body, new Date(now), true).Length();
    major = minor = ((2 * radiusKm[t.body]) / (au * 149_597_870.7)) * (180 / Math.PI) * 60;
  }
  if (major == null) return { fits: true, note: "point source (star): fits anywhere in the frame" };
  minor = minor ?? major;
  const fitsPlain = major <= S30PRO.longArcmin * 0.9 && minor <= S30PRO.shortArcmin * 0.9;
  const pixels = Math.round((major * 60) / S30PRO.arcsecPerPx);
  const fill = Math.min(1, (major / S30PRO.longArcmin));
  const pa = t.positionAngle;
  return {
    apparent_size_arcmin: { major: r1(major), minor: r1(minor) },
    fits: fitsPlain,
    long_axis_pixels: pixels,
    fills_pct_of_long_side: Math.round(fill * 100),
    best_rotation:
      pa == null || major - minor < 2
        ? "any (target is round or its angle is unknown)"
        : `turn the frame so its long side runs at position angle ${Math.round(pa)} deg (east of north), along the target's long axis`,
    ...(fitsPlain
      ? pixels < 60
        ? { note: "small in frame: crop or use the S30 Pro's zoom view" }
        : {}
      : {
          mosaic: {
            panels_long: Math.ceil(major / (S30PRO.longArcmin * 0.8)),
            panels_short: Math.ceil(minor / (S30PRO.shortArcmin * 0.8)),
            note: "panel counts with about 20% overlap",
          },
        }),
  };
}
