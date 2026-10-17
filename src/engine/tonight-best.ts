/**
 * Tonight's Best: the 10-15 targets most worth going outside for tonight.
 *
 * Pure (no DOM), so it runs in Node tests. Two passes:
 *
 * 1. A fast pass over the whole catalogue on a 10-minute grid. Altitude
 *    comes from the hour angle against sidereal time worked out once per
 *    grid step, so thousands of objects cost a few milliseconds. The Moon is
 *    computed once per step and shared.
 * 2. The best-scoring candidates are rebuilt with the object page's own
 *    5-minute model (altitude-curve.ts), and checked again. Each row's best
 *    window, peak and sparkline therefore match its object page exactly.
 *
 * ── The rule (who gets in) ───────────────────────────────────────────
 * Deep-sky objects and double stars: at least `minAlt` (default 30°) for
 * at least `minHours` (default 1 h) in one stretch of astronomical dark
 * (Sun below -18°; nautical dark, Sun below -12°, where the night never gets
 * fully dark). This is the Telescopius "What's in the sky tonight" rule.
 * Planets and the Moon are bright enough for twilight, so for them the
 * stretch may fall anywhere from civil dusk to civil dawn (Sun below -6°).
 * Diffuse targets (galaxies, nebulae) are also dropped when the Moon is up
 * for over half their window and comes closer than 10° + 30° x illumination
 * (10° at new Moon, 40° at full).
 *
 * ── The score (who ranks first), out of 100 ──────────────────────────
 * SCORE_WEIGHTS below, each part 0 to 1:
 *   time       30  hours of the window / 4 h (4 h or more scores 1)
 *   peak       20  (peak altitude - minAlt) / (90° - minAlt)
 *   moon       20  1 - sensitivity x illumination x share of window the
 *                  Moon is up x closeness (1 within 10°, falling to 0.25 at
 *                  90° or more, since moonlight brightens the whole sky)
 *   brightness 20  equipment.ts brightnessScore(): magnitude margin for
 *                  stars and clusters, magnitude and surface brightness
 *                  margins averaged for galaxies and nebulae
 *   cloud      10  1 - mean cloud cover over the window; 1 when there is no
 *                  forecast, so a missing forecast changes no order
 * Moon sensitivity by type: galaxies and nebulae 1, planetary nebulae and
 * globular clusters 0.5, open clusters 0.3, double stars 0.1, planets 0.
 *
 * ── The list ─────────────────────────────────────────────────────────
 * The Moon and naked-eye planets that pass are pinned first. The rest follow by
 * score. With more than one type showing, no type takes more than
 * `perGroupCap` (5) rows, so 4,000 galaxies cannot crowd out the clusters.
 */

import * as Astronomy from "astronomy-engine";
import type { GeoLocation } from "../types.ts";
import { azimuthToCompassShort, getTwilightTimes } from "./astro.ts";
import {
  analyseNight,
  buildAltitudeModel,
  type CurveTarget,
} from "./altitude-curve.ts";
import {
  brightnessScore,
  classWithin,
  equipmentClass,
  type EquipmentClass,
  type VisualTarget,
} from "./equipment.ts";

export type BestGroup = "planets" | "galaxies" | "nebulae" | "clusters" | "doubles";

export const BEST_GROUPS: BestGroup[] = [
  "planets",
  "galaxies",
  "nebulae",
  "clusters",
  "doubles",
];

export const SCORE_WEIGHTS = {
  time: 30,
  peak: 20,
  moon: 20,
  brightness: 20,
  cloud: 10,
} as const;

export type ScoreParts = Record<keyof typeof SCORE_WEIGHTS, number>;

export interface BestCandidate {
  id: string;
  name: string;
  group: BestGroup;
  /** Catalogue type (galaxy, open-cluster, planet, moon, double-star). */
  typeKey: string;
  target: VisualTarget;
  pos: CurveTarget;
  /** Double stars: separation of the pair, arcseconds. */
  sepArcsec?: number | null;
}

export interface BestOptions {
  equipment: EquipmentClass;
  /** Types to show; empty means all. */
  groups: BestGroup[];
  minAlt: number;
  minHours: number;
  limit: number;
  perGroupCap: number;
  /** Cloud cover 0-1 at an instant, or null when there is no forecast. */
  cloud?: (ms: number) => number | null;
  /** Grid step of the fast pass, minutes. */
  stepMin: number;
}

export const DEFAULT_BEST_OPTIONS: BestOptions = {
  equipment: "binoculars",
  groups: [],
  minAlt: 30,
  minHours: 1,
  limit: 15,
  perGroupCap: 5,
  stepMin: 10,
};

export interface SparkPoint {
  t: number;
  alt: number;
}

export interface BestRow {
  cand: BestCandidate;
  score: number;
  parts: ScoreParts;
  pinned: boolean;
  /** The best window: longest stretch above minAlt in the dark. */
  start: number;
  end: number;
  hours: number;
  peakAlt: number;
  peakAz: number;
  peakT: number;
  /** Share of the window (0-1) with the Moon up. */
  moonUpFraction: number;
  /** Closest Moon approach while it is up in the window, degrees. */
  moonMinSep: number | null;
  moonIllum: number;
  cloudMean: number | null;
  needs: EquipmentClass;
  /** Altitude every 15 min from sunset to sunrise (object-page samples). */
  spark: SparkPoint[];
}

export interface NightGrid {
  loc: GeoLocation;
  at: Date;
  /** Sunset to sunrise (ms), or null without a night. */
  night: { start: number; end: number } | null;
  /** Astronomical (else nautical) dark, or null. */
  dark: { start: number; end: number; kind: "astro" | "nautical" } | null;
  /** Civil dusk to civil dawn: the planets' range. */
  twilight: { start: number; end: number } | null;
  stepMs: number;
  t: number[];
  sinLst: number[];
  cosLst: number[];
  moonAlt: number[];
  /** Moon's unit vector (equatorial) at each step. */
  moonVec: [number, number, number][];
  moonIllum: number;
}

export interface BestResult {
  grid: NightGrid;
  rows: BestRow[];
  /** Candidates that passed the type and equipment filters. */
  considered: number;
}

const DEG = Math.PI / 180;

/** Precompute the shared grid for the night `at` belongs to. */
export function prepareNight(loc: GeoLocation, at: Date, stepMin = 10): NightGrid {
  const tw = getTwilightTimes(loc, at);
  const span = (a: Date | null, b: Date | null) =>
    a && b && b > a ? { start: a.getTime(), end: b.getTime() } : null;
  const night = span(tw.sunset, tw.sunrise);
  const astro = span(tw.astronomicalDusk, tw.astronomicalDawn);
  const naut = span(tw.nauticalDusk, tw.nauticalDawn);
  const dark = astro
    ? { ...astro, kind: "astro" as const }
    : naut
      ? { ...naut, kind: "nautical" as const }
      : null;
  const twilight = span(tw.civilDusk, tw.civilDawn) ?? night;

  const stepMs = stepMin * 60_000;
  const outer = twilight ?? dark;
  const t: number[] = [];
  if (outer) {
    const from = Math.ceil(outer.start / stepMs) * stepMs;
    for (let ms = from; ms <= outer.end; ms += stepMs) t.push(ms);
  }
  const obs = new Astronomy.Observer(loc.lat, loc.lon, loc.elev);
  const sinLst: number[] = [];
  const cosLst: number[] = [];
  const moonAlt: number[] = [];
  const moonVec: [number, number, number][] = [];
  for (const ms of t) {
    const d = new Date(ms);
    const lst = (Astronomy.SiderealTime(d) * 15 + loc.lon) * DEG;
    sinLst.push(Math.sin(lst));
    cosLst.push(Math.cos(lst));
    const eq = Astronomy.Equator(Astronomy.Body.Moon, d, obs, true, true);
    moonAlt.push(Astronomy.Horizon(d, obs, eq.ra, eq.dec, "normal").altitude);
    moonVec.push(unitVec(eq.ra, eq.dec));
  }
  const mid = night ? (night.start + night.end) / 2 : at.getTime();
  const moonIllum = Astronomy.Illumination(Astronomy.Body.Moon, new Date(mid)).phase_fraction;
  return { loc, at, night, dark, twilight, stepMs, t, sinLst, cosLst, moonAlt, moonVec, moonIllum };
}

function unitVec(raHours: number, decDeg: number): [number, number, number] {
  const a = raHours * 15 * DEG;
  const d = decDeg * DEG;
  return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
}

function sepDeg(u: [number, number, number], v: [number, number, number]): number {
  const dot = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  return Math.acos(Math.max(-1, Math.min(1, dot))) / DEG;
}

// ── Moon ─────────────────────────────────────────────────────────────

/** How much moonlight hurts this kind of target, 0 (not at all) to 1. */
export function moonSensitivity(c: Pick<BestCandidate, "typeKey" | "group">): number {
  if (c.group === "planets") return 0;
  if (c.group === "doubles") return 0.1;
  if (c.typeKey === "open-cluster" || c.typeKey === "cluster") return 0.3;
  if (c.typeKey === "globular-cluster" || c.typeKey === "planetary-nebula") return 0.5;
  return 1;
}

/** 1 when the Moon is within 10°, falling linearly to 0.25 at 90° or more. */
export function moonCloseness(sep: number | null): number {
  if (sep === null) return 0;
  if (sep <= 10) return 1;
  if (sep >= 90) return 0.25;
  return 1 - (0.75 * (sep - 10)) / 80;
}

/** The Moon penalty, 0 (none) to 1 (ruinous). */
export function moonPenalty(
  sensitivity: number,
  illum: number,
  upFraction: number,
  minSep: number | null,
): number {
  if (upFraction <= 0) return 0;
  return sensitivity * illum * upFraction * moonCloseness(minSep);
}

/** The Telescopius-style hard rule: too close to a bright Moon to bother. */
export function moonExcludes(
  sensitivity: number,
  illum: number,
  upFraction: number,
  minSep: number | null,
): boolean {
  if (sensitivity < 1 || upFraction <= 0.5 || minSep === null) return false;
  return minSep < 10 + 30 * illum;
}

// ── Score ────────────────────────────────────────────────────────────

export function totalScore(parts: ScoreParts): number {
  let s = 0;
  for (const k of Object.keys(SCORE_WEIGHTS) as (keyof ScoreParts)[]) {
    s += SCORE_WEIGHTS[k] * Math.max(0, Math.min(1, parts[k]));
  }
  return Math.round(s * 10) / 10;
}

export function scoreParts(
  x: {
    hours: number;
    peakAlt: number;
    moonUpFraction: number;
    moonMinSep: number | null;
    moonIllum: number;
    cloudMean: number | null;
  },
  cand: BestCandidate,
  opts: Pick<BestOptions, "minAlt" | "equipment">,
): ScoreParts {
  return {
    time: Math.min(1, x.hours / 4),
    peak: Math.max(0, Math.min(1, (x.peakAlt - opts.minAlt) / (90 - opts.minAlt))),
    moon:
      1 -
      moonPenalty(moonSensitivity(cand), x.moonIllum, x.moonUpFraction, x.moonMinSep),
    brightness: brightnessScore(cand.target, opts.equipment),
    cloud: x.cloudMean === null ? 1 : 1 - x.cloudMean,
  };
}

// ── Filters ──────────────────────────────────────────────────────────

/** Type and equipment filters, before any sky maths. */
export function passesFilters(c: BestCandidate, opts: Pick<BestOptions, "groups" | "equipment">): boolean {
  if (opts.groups.length && !opts.groups.includes(c.group)) return false;
  return classWithin(equipmentClass(c.target), opts.equipment);
}

// ── Fast pass ────────────────────────────────────────────────────────

interface Fast {
  start: number;
  end: number;
  hours: number;
  peakAlt: number;
  peakT: number;
  moonUpFraction: number;
  moonMinSep: number | null;
  cloudMean: number | null;
}

/** Altitude at each grid step for a fixed RA/Dec (geometric, no refraction). */
function radecAlts(grid: NightGrid, ra: number, dec: number): number[] {
  const sinPhi = Math.sin(grid.loc.lat * DEG);
  const cosPhi = Math.cos(grid.loc.lat * DEG);
  const sd = Math.sin(dec * DEG);
  const cd = Math.cos(dec * DEG);
  const sa = Math.sin(ra * 15 * DEG);
  const ca = Math.cos(ra * 15 * DEG);
  const out = new Array<number>(grid.t.length);
  for (let i = 0; i < grid.t.length; i++) {
    // cos(H) = cos(LST - RA)
    const cosH = grid.cosLst[i] * ca + grid.sinLst[i] * sa;
    out[i] = Math.asin(sinPhi * sd + cosPhi * cd * cosH) / DEG;
  }
  return out;
}

function bodyAlts(grid: NightGrid, body: string): { alt: number[]; vec: [number, number, number][] } {
  const b = (Object.values(Astronomy.Body) as string[]).find(
    (x) => x.toLowerCase() === body.toLowerCase(),
  ) as Astronomy.Body;
  const obs = new Astronomy.Observer(grid.loc.lat, grid.loc.lon, grid.loc.elev);
  const alt: number[] = [];
  const vec: [number, number, number][] = [];
  for (const ms of grid.t) {
    const d = new Date(ms);
    const eq = Astronomy.Equator(b, d, obs, true, true);
    alt.push(Astronomy.Horizon(d, obs, eq.ra, eq.dec, "normal").altitude);
    vec.push(unitVec(eq.ra, eq.dec));
  }
  return { alt, vec };
}

function fastPass(c: BestCandidate, grid: NightGrid, opts: BestOptions): Fast | null {
  const isBody = c.pos.kind === "body";
  const range = isBody ? grid.twilight : grid.dark;
  if (!range || !grid.t.length) return null;
  let alts: number[];
  let vecAt: (i: number) => [number, number, number];
  if (c.pos.kind === "radec") {
    const { ra, dec } = c.pos;
    // Cheapest test first: its highest possible altitude.
    if (90 - Math.abs(grid.loc.lat - dec) < opts.minAlt) return null;
    alts = radecAlts(grid, ra, dec);
    const v = unitVec(ra, dec);
    vecAt = () => v;
  } else {
    const b = bodyAlts(grid, c.pos.body);
    alts = b.alt;
    vecAt = (i) => b.vec[i];
  }
  // Longest run of steps inside `range` at or above minAlt.
  let best: [number, number] | null = null;
  let runStart = -1;
  for (let i = 0; i <= grid.t.length; i++) {
    const ok =
      i < grid.t.length &&
      grid.t[i] >= range.start &&
      grid.t[i] <= range.end &&
      alts[i] >= opts.minAlt;
    if (ok && runStart < 0) runStart = i;
    if (!ok && runStart >= 0) {
      if (!best || i - 1 - runStart > best[1] - best[0]) best = [runStart, i - 1];
      runStart = -1;
    }
  }
  if (!best) return null;
  const [a, b] = best;
  const hours = ((b - a) * grid.stepMs) / 3_600_000;
  if (hours + 1e-9 < opts.minHours) return null;
  let peakI = a;
  let up = 0;
  let minSep: number | null = null;
  let cloudSum = 0;
  let cloudN = 0;
  for (let i = a; i <= b; i++) {
    if (alts[i] > alts[peakI]) peakI = i;
    if (c.group !== "planets" || c.typeKey !== "moon") {
      if (grid.moonAlt[i] > 0) {
        up += 1;
        const s = sepDeg(grid.moonVec[i], vecAt(i));
        minSep = minSep === null ? s : Math.min(minSep, s);
      }
    }
    const cl = opts.cloud?.(grid.t[i]);
    if (cl !== null && cl !== undefined) {
      cloudSum += cl;
      cloudN += 1;
    }
  }
  return {
    start: grid.t[a],
    end: grid.t[b],
    hours,
    peakAlt: alts[peakI],
    peakT: grid.t[peakI],
    moonUpFraction: c.typeKey === "moon" ? 0 : up / (b - a + 1),
    moonMinSep: c.typeKey === "moon" ? null : minSep,
    cloudMean: cloudN ? cloudSum / cloudN : null,
  };
}

// ── Ranking ──────────────────────────────────────────────────────────

/** Pinned to the top: the Moon and the naked-eye planets (Mercury to
 *  Saturn). Uranus and Neptune are binocular targets and rank by score. */
export function isPinned(c: BestCandidate): boolean {
  return c.typeKey === "moon" || (c.typeKey === "planet" && (c.target.mag ?? 99) <= 5.5);
}

/**
 * Rank `cands` for the night `at` belongs to. At 2 pm that is tonight; at
 * 3 am it is the night in progress, so the list doubles as a daytime plan.
 */
export function rankTonightsBest(
  cands: BestCandidate[],
  loc: GeoLocation,
  at: Date,
  options: Partial<BestOptions> = {},
): BestResult {
  const opts: BestOptions = { ...DEFAULT_BEST_OPTIONS, ...options };
  const grid = prepareNight(loc, at, opts.stepMin);
  const filtered = cands.filter((c) => passesFilters(c, opts));

  const scored: { cand: BestCandidate; fast: Fast; score: number }[] = [];
  for (const cand of filtered) {
    const fast = fastPass(cand, grid, opts);
    if (!fast) continue;
    const sens = moonSensitivity(cand);
    if (moonExcludes(sens, grid.moonIllum, fast.moonUpFraction, fast.moonMinSep)) continue;
    const score = totalScore(scoreParts({ ...fast, moonIllum: grid.moonIllum }, cand, opts));
    scored.push({ cand, fast, score });
  }
  // Planets and the Moon first, so they are never crowded out; then score.
  scored.sort(
    (x, y) =>
      Number(isPinned(y.cand)) - Number(isPinned(x.cand)) ||
      y.score - x.score ||
      x.cand.name.localeCompare(y.cand.name),
  );

  // Second pass: the object page's model, in score order, until full.
  const showing = opts.groups.length ? opts.groups.length : BEST_GROUPS.length;
  const cap = showing > 1 ? opts.perGroupCap : Infinity;
  const perGroup = new Map<BestGroup, number>();
  const rows: BestRow[] = [];
  for (const s of scored) {
    if (rows.length >= opts.limit) break;
    if (!isPinned(s.cand) && (perGroup.get(s.cand.group) ?? 0) >= cap) continue;
    const row = refine(s.cand, s.fast, grid, opts);
    if (!row) continue;
    rows.push(row);
    perGroup.set(s.cand.group, (perGroup.get(s.cand.group) ?? 0) + 1);
  }
  rows.sort((x, y) => Number(y.pinned) - Number(x.pinned) || y.score - x.score);
  return { grid, rows, considered: filtered.length };
}

/** Rebuild one candidate with the object page's 5-minute model. */
function refine(
  cand: BestCandidate,
  fast: Fast,
  grid: NightGrid,
  opts: BestOptions,
): BestRow | null {
  const model = buildAltitudeModel(cand.pos, grid.loc, grid.at);
  const isBody = cand.pos.kind === "body";
  let start = fast.start;
  let end = fast.end;
  let peakAlt = fast.peakAlt;
  let peakT = fast.peakT;
  let peakAz = model.samples[0]?.az ?? 0;
  let moonUpFraction = fast.moonUpFraction;
  let moonMinSep = fast.moonMinSep;
  if (!isBody) {
    // Deep sky must pass the rule on the page's own numbers too.
    const a = analyseNight(model, opts.minAlt);
    if (!a.best) return null;
    if (a.best.end - a.best.start < opts.minHours * 3_600_000 - 60_000) return null;
    start = a.best.start;
    end = a.best.end;
    peakAlt = a.best.peak.alt;
    peakT = a.best.peak.t;
    peakAz = a.best.peak.az;
    moonUpFraction = a.best.moonUpFraction;
    moonMinSep = a.best.moonMinSep;
  } else {
    // Planets: the fast window (twilight allowed); azimuth from the model.
    const near = model.samples.reduce((p, s) =>
      Math.abs(s.t - peakT) < Math.abs(p.t - peakT) ? s : p,
    );
    peakAz = near.az;
    peakAlt = near.alt;
  }
  const hours = (end - start) / 3_600_000;
  const parts = scoreParts(
    { hours, peakAlt, moonUpFraction, moonMinSep, moonIllum: grid.moonIllum, cloudMean: fast.cloudMean },
    cand,
    opts,
  );
  const range = model.night ?? model.span24;
  const spark = model.samples
    .filter((s, i) => i % 3 === 0 && s.t >= range.start && s.t <= range.end)
    .map((s) => ({ t: s.t, alt: s.alt }));
  return {
    cand,
    score: totalScore(parts),
    parts,
    pinned: isPinned(cand),
    start,
    end,
    hours,
    peakAlt,
    peakAz,
    peakT,
    moonUpFraction,
    moonMinSep,
    moonIllum: grid.moonIllum,
    cloudMean: fast.cloudMean,
    needs: equipmentClass(cand.target),
    spark,
  };
}

// ── "Why" line ───────────────────────────────────────────────────────

/** The why line says "well clear of the Moon" only from this far away. */
export const MOON_CLEAR_DEG = 45;

export interface WhyPart {
  key: string;
  params?: Record<string, string | number>;
}

/**
 * The reasons behind a row, most telling first, as translation keys. The UI
 * joins the first three with " · ".
 */
export function whyParts(row: BestRow, opts: Pick<BestOptions, "minAlt" | "equipment">): WhyPart[] {
  const out: WhyPart[] = [];
  const h = Math.round(row.hours * 2) / 2;
  out.push({
    key: row.cand.pos.kind === "body" ? "best.why.twilightHours" : "best.why.darkHours",
    params: { hours: h, min: opts.minAlt },
  });
  if (row.cand.group !== "planets") {
    const illum = Math.round(row.moonIllum * 100);
    if (row.moonUpFraction === 0 || row.moonMinSep === null) out.push({ key: "best.why.moonDown" });
    // "Well clear" is about distance, not the penalty: a double star barely
    // minds the Moon, but 15° away is still not "well clear".
    else if (row.parts.moon < 0.75 || row.moonMinSep < MOON_CLEAR_DEG)
      out.push({ key: "best.why.moonClose", params: { illum, sep: Math.round(row.moonMinSep) } });
    else out.push({ key: "best.why.moonFar", params: { sep: Math.round(row.moonMinSep) } });
  }
  const sep = row.cand.sepArcsec;
  if (row.pinned) out.push({ key: "best.why.planet" });
  else if (row.cand.group === "doubles" && sep)
    out.push(
      sep >= 60
        ? { key: "best.why.pairArcmin", params: { sep: Math.round(sep / 60) } }
        : { key: "best.why.pairArcsec", params: { sep } },
    );
  else if (row.parts.brightness >= 0.6) out.push({ key: `best.why.easy.${opts.equipment}` });
  else if (row.parts.brightness < 0.25) out.push({ key: "best.why.faint" });
  if (
    opts.equipment === "smart-scope" &&
    (row.cand.target.size ?? 0) > 80
  )
    out.push({ key: "best.why.wide" });
  if (row.cloudMean !== null)
    out.push({ key: "best.why.cloud", params: { pct: Math.round(row.cloudMean * 100) } });
  return out;
}

export function compassOf(row: BestRow): string {
  return azimuthToCompassShort(row.peakAz);
}

// ── Candidates from the catalogues ───────────────────────────────────

interface DSOLike {
  id: string;
  name: string;
  commonName: string;
  type: string;
  ra: number;
  dec: number;
  magnitude: number;
  size: number;
  minorAxis: number | null;
  surfaceBrightness: number | null;
  caldwell?: string | null;
}
interface StarLike {
  id: string;
  name: string;
  ra: number;
  dec: number;
  magnitude: number;
}
interface DoubleLike {
  star: string;
  sepArcsec: number | null;
  needs: EquipmentClass;
}

/** A bare star designation such as "gam Cyg": OpenNGC's name for the
 *  nebulosity round a bright star, whose magnitude is the star's. */
const STAR_DESIGNATION = /^[a-z]{2,3}\d? [A-Z][a-z]{2}$/;

/**
 * The showpiece pool: Messier, Caldwell and objects with a common name (about
 * 255), the kind of list Seestar's "Tonight's Best" draws from. Without it the
 * 4,000 faint NGC galaxies near the zenith would fill every smart-telescope
 * list. Extended objects with no size, or named after a star, are skipped:
 * their magnitude is the embedded star's, so they would rank as bright.
 */
export function isShowpiece(d: DSOLike): boolean {
  const known = /^M\d/.test(d.id) || !!d.caldwell || !!d.commonName;
  if (!known) return false;
  const group = groupForDsoType(d.type);
  if (group === "nebulae" || group === "galaxies") {
    if (!d.size || d.size <= 0) return false;
    if (STAR_DESIGNATION.test(d.commonName)) return false;
  }
  return true;
}

export function groupForDsoType(type: string): BestGroup | null {
  if (type.startsWith("galaxy")) return "galaxies";
  if (type === "double-star") return "doubles";
  if (type.endsWith("cluster")) return "clusters";
  if (/nebula|remnant|hii/.test(type)) return "nebulae";
  return null;
}

/** Solar System bodies Tonight's Best considers (ids match the app's). */
export const BEST_BODIES: { id: string; body: string; mag: number }[] = [
  { id: "moon", body: "Moon", mag: -10 },
  { id: "planet-mercury", body: "Mercury", mag: 0 },
  { id: "planet-venus", body: "Venus", mag: -4 },
  { id: "planet-mars", body: "Mars", mag: 0.5 },
  { id: "planet-jupiter", body: "Jupiter", mag: -2.2 },
  { id: "planet-saturn", body: "Saturn", mag: 0.7 },
  { id: "planet-uranus", body: "Uranus", mag: 5.7 },
  { id: "planet-neptune", body: "Neptune", mag: 7.8 },
];

export function buildCandidates(
  dsos: DSOLike[],
  stars: StarLike[],
  doubles: DoubleLike[],
  names: { moon: string; planet: (body: string) => string } = {
    moon: "Moon",
    planet: (b) => b,
  },
): BestCandidate[] {
  const out: BestCandidate[] = [];
  for (const b of BEST_BODIES) {
    const isMoon = b.body === "Moon";
    out.push({
      id: b.id,
      name: isMoon ? names.moon : names.planet(b.body),
      group: "planets",
      typeKey: isMoon ? "moon" : "planet",
      target: { kind: isMoon ? "moon" : "planet", mag: b.mag },
      pos: { kind: "body", body: b.body },
    });
  }
  for (const d of dsos) {
    const group = groupForDsoType(d.type);
    if (!group || !isShowpiece(d)) continue;
    out.push({
      id: `dso-${d.id}`,
      name: d.commonName || d.name,
      group,
      typeKey: d.type,
      target: {
        kind: "dso",
        mag: Number.isFinite(d.magnitude) && d.magnitude < 90 ? d.magnitude : null,
        dsoType: d.type,
        size: d.size,
        minor: d.minorAxis,
        surfaceBrightness: d.surfaceBrightness,
      },
      pos: { kind: "radec", ra: d.ra, dec: d.dec },
    });
  }
  const byId = new Map(stars.map((s) => [s.id, s]));
  for (const dbl of doubles) {
    const s = byId.get(dbl.star);
    if (!s) continue;
    out.push({
      id: `star-${s.id}`,
      name: s.name,
      group: "doubles",
      typeKey: "double-star",
      target: { kind: "star", mag: s.magnitude, needs: dbl.needs },
      pos: { kind: "radec", ra: s.ra, dec: s.dec },
      sepArcsec: dbl.sepArcsec,
    });
  }
  return out;
}
