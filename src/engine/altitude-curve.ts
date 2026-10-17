/**
 * Altitude-vs-time model for the object page chart.
 *
 * One 5-minute curve (from the shared sampler in astro.ts) over 24 hours
 * centred on tonight's solar midnight feeds everything: the drawn curve,
 * rise/transit/set, the twilight bands, the Moon line, the best window and
 * the summary sentence. Nothing here touches the DOM, so it runs in Node tests.
 */

import * as Astronomy from "astronomy-engine";
import type { GeoLocation } from "../types.ts";
import {
  CURVE_STEP_MIN,
  angularSeparation,
  azimuthToCompassShort,
  bisectCrossing,
  curveCrossings,
  getAltitudeCurveForBody,
  getAltitudeCurveForRaDec,
  getTwilightTimes,
  polarState,
  raDecAltAt,
} from "./astro.ts";
import type { AltSample } from "./astro.ts";

export type CurveTarget =
  | { kind: "radec"; ra: number; dec: number }
  | { kind: "body"; body: string };

export type BandKind = "day" | "civil" | "nautical" | "astro" | "dark";

export interface Band {
  from: number;
  to: number;
  kind: BandKind;
}

export type CurveState =
  /** Crosses the horizon in these 24 hours. */
  | "rises-sets"
  /** Circumpolar: never sets at this latitude. */
  | "always-up"
  /** Never clears the horizon at this latitude. */
  | "never-rises"
  /** A moving body that stays up for the whole 24 hours. */
  | "up-all-day"
  /** A moving body that stays down for the whole 24 hours. */
  | "down-all-day";

export interface Span {
  start: number;
  end: number;
}

export interface MoonPoint {
  alt: number;
  /** Degrees between the Moon and the target. */
  sep: number;
}

export interface AltitudeModel {
  isMoon: boolean;
  /** The 24 hours the samples cover, centred on tonight's solar midnight. */
  span24: Span;
  /** Sunset to sunrise, or null when the Sun does not both set and rise. */
  night: Span | null;
  polar: "midnight-sun" | "polar-night" | null;
  /** The target, every 5 minutes across span24. */
  samples: AltSample[];
  /** Sun's geometric altitude at each sample (for bands and darkness). */
  sun: number[];
  /** Moon at each sample; null when the target is the Moon. */
  moon: MoonPoint[] | null;
  /** Moon's illuminated fraction (0-1) at the middle of the night. */
  moonIllum: number;
  bands: Band[];
  state: CurveState;
  rise: number | null;
  transit: number | null;
  set: number | null;
  /** Altitude and azimuth at transit (upper culmination). */
  transitAlt: number | null;
  transitAz: number | null;
  /** Target altitude at any instant, for refining edges. */
  altAt: (ms: number) => number;
  sunAltAt: (ms: number) => number;
}

/** Sun's centre at sunrise/sunset: 34' refraction plus 16' semi-diameter. */
export const SUNSET_ALT = -0.8333;
const BAND_LIMITS = [SUNSET_ALT, -6, -12, -18];
const BAND_KINDS: BandKind[] = ["day", "civil", "nautical", "astro", "dark"];

function bandLevel(sunAlt: number): number {
  let level = 0;
  for (const lim of BAND_LIMITS) if (sunAlt < lim) level += 1;
  return level;
}

function findBody(name: string): Astronomy.Body | null {
  return (
    ((Object.values(Astronomy.Body) as string[]).find(
      (b) => b.toLowerCase() === name.toLowerCase(),
    ) as Astronomy.Body | undefined) ?? null
  );
}

/** Tonight's solar midnight: the Sun's lower culmination nearest `at`'s night. */
function solarMidnight(obs: Astronomy.Observer, at: Date): number {
  const from = new Date(at.getTime() - 12 * 3_600_000);
  return Astronomy.SearchHourAngle(Astronomy.Body.Sun, obs, 12, from, +1).time.date.getTime();
}

/**
 * Build the model for `target` seen from `loc` on the night `at` belongs to
 * (at 2 pm: tonight; at 3 am: the night in progress).
 */
export function buildAltitudeModel(
  target: CurveTarget,
  loc: GeoLocation,
  at: Date,
): AltitudeModel {
  const obs = new Astronomy.Observer(loc.lat, loc.lon, loc.elev);
  const tw = getTwilightTimes(loc, at);
  const night: Span | null =
    tw.sunset && tw.sunrise && tw.sunrise > tw.sunset
      ? { start: tw.sunset.getTime(), end: tw.sunrise.getTime() }
      : null;
  const mid = night ? (night.start + night.end) / 2 : solarMidnight(obs, at);
  const span24: Span = {
    start: Math.min(mid - 12 * 3_600_000, night?.start ?? Infinity),
    end: Math.max(mid + 12 * 3_600_000, night?.end ?? -Infinity),
  };
  const from = new Date(span24.start);
  const to = new Date(span24.end);

  // Target curve.
  let samples: AltSample[];
  let raDecAt: (i: number) => { ra: number; dec: number };
  let altAt: (ms: number) => number;
  let isMoon = false;
  if (target.kind === "radec") {
    samples = getAltitudeCurveForRaDec(target.ra, target.dec, loc, from, to);
    raDecAt = () => ({ ra: target.ra, dec: target.dec });
    altAt = raDecAltAt(target.ra, target.dec, loc);
  } else {
    const body = findBody(target.body);
    if (!body) throw new Error(`Unknown body ${target.body}`);
    isMoon = body === Astronomy.Body.Moon;
    const curve = getAltitudeCurveForBody(body, loc, from, to);
    samples = curve;
    raDecAt = (i) => curve[i];
    altAt = (ms) => {
      const d = new Date(ms);
      const eq = Astronomy.Equator(body, d, obs, true, true);
      return Astronomy.Horizon(d, obs, eq.ra, eq.dec, "normal").altitude;
    };
  }

  // Sun (geometric, as SearchAltitude and so the twilight bar use it).
  const sunAltAt = (ms: number) => {
    const d = new Date(ms);
    const eq = Astronomy.Equator(Astronomy.Body.Sun, d, obs, true, true);
    return Astronomy.Horizon(d, obs, eq.ra, eq.dec).altitude;
  };
  const sun = samples.map((s) => sunAltAt(s.t));

  // Moon.
  let moon: MoonPoint[] | null = null;
  if (!isMoon) {
    const mc = getAltitudeCurveForBody(Astronomy.Body.Moon, loc, from, to);
    moon = mc.map((m, i) => {
      const tgt = raDecAt(i);
      return { alt: m.alt, sep: angularSeparation(m.ra, m.dec, tgt.ra, tgt.dec) };
    });
  }
  const moonIllum = Astronomy.Illumination(Astronomy.Body.Moon, new Date(mid)).phase_fraction;

  // Twilight bands, edges bisected on the Sun's altitude.
  const bands: Band[] = [];
  let level = bandLevel(sun[0]);
  let bandStart = samples[0].t;
  for (let i = 1; i < samples.length; i++) {
    const next = bandLevel(sun[i]);
    if (next === level) continue;
    const lim = BAND_LIMITS[Math.min(level, next)];
    const edge = bisectCrossing((ms) => sunAltAt(ms) - lim, samples[i - 1].t, samples[i].t);
    bands.push({ from: bandStart, to: edge, kind: BAND_KINDS[level] });
    bandStart = edge;
    level = next;
  }
  bands.push({ from: bandStart, to: samples[samples.length - 1].t, kind: BAND_KINDS[level] });

  let polar: AltitudeModel["polar"] = null;
  if (!night) {
    if (sun.every((a) => a > SUNSET_ALT)) polar = "midnight-sun";
    else if (sun.every((a) => a <= SUNSET_ALT)) polar = "polar-night";
  }

  // Transit: the highest sample, refined with a parabola through its neighbours.
  let iMax = 0;
  for (let i = 1; i < samples.length; i++) if (samples[i].alt > samples[iMax].alt) iMax = i;
  let transit: number | null = null;
  let transitAlt: number | null = null;
  let transitAz: number | null = null;
  if (iMax > 0 && iMax < samples.length - 1) {
    const [a, b, c] = [samples[iMax - 1].alt, samples[iMax].alt, samples[iMax + 1].alt];
    const denom = a - 2 * b + c;
    const offset = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
    transit = samples[iMax].t + offset * CURVE_STEP_MIN * 60_000;
    transitAlt = altAt(transit);
    transitAz = samples[iMax].az;
  }

  // Rise and set: the pass around transit.
  const polarFixed = target.kind === "radec" ? polarState(loc.lat, target.dec) : null;
  const crossings = polarFixed ? [] : curveCrossings(samples, 0, altAt);
  const ref = transit ?? samples[iMax].t;
  const rises = crossings.filter((c) => c.kind === "rise");
  const sets = crossings.filter((c) => c.kind === "set");
  const riseEv = [...rises].reverse().find((c) => c.at <= ref) ?? rises[0];
  const setEv = sets.find((c) => c.at >= ref) ?? sets[sets.length - 1];

  let state: CurveState;
  if (polarFixed === "always-up" || polarFixed === "never-rises") state = polarFixed;
  else if (crossings.length) state = "rises-sets";
  else state = samples[0].alt > 0 ? "up-all-day" : "down-all-day";
  if (state === "down-all-day" && target.kind === "radec") state = "never-rises";

  return {
    isMoon,
    span24,
    night,
    polar,
    samples,
    sun,
    moon,
    moonIllum,
    bands,
    state,
    rise: riseEv?.at ?? null,
    transit,
    set: setEv?.at ?? null,
    transitAlt,
    transitAz,
    altAt,
    sunAltAt,
  };
}

// ── Tonight's analysis (depends on the minimum altitude) ─────────

export interface BestWindow {
  start: number;
  end: number;
  /** Which darkness the window uses: full (astronomical) or, where the
   *  night never gets fully dark, nautical. */
  darkness: "astro" | "nautical";
  /** Share of the window (0-1) with the Moon above the horizon. */
  moonUpFraction: number;
  /** Closest Moon approach while it is up in the window (degrees). */
  moonMinSep: number | null;
  /** Highest point inside the window. */
  peak: AltSample;
}

export type NoBestReason =
  | "never-rises"
  | "below-all-night"
  | "too-low"
  | "not-in-dark"
  | "no-dark";

export interface NightAnalysis {
  /** The span the analysis covers: the night, or 24 h where there is none. */
  range: Span;
  peak: AltSample;
  best: BestWindow | null;
  reason: NoBestReason | null;
  minAlt: number;
}

export function analyseNight(model: AltitudeModel, minAlt: number): NightAnalysis {
  const range = model.night ?? model.span24;
  const idx: number[] = [];
  model.samples.forEach((s, i) => {
    if (s.t >= range.start && s.t <= range.end) idx.push(i);
  });
  let peakI = idx[0];
  for (const i of idx) if (model.samples[i].alt > model.samples[peakI].alt) peakI = i;
  const peak = model.samples[peakI];

  const darkAlt = idx.some((i) => model.sun[i] < -18)
    ? -18
    : idx.some((i) => model.sun[i] < -12)
      ? -12
      : null;

  let best: BestWindow | null = null;
  if (darkAlt !== null) {
    const ok = (ms: number) => model.altAt(ms) >= minAlt && model.sunAltAt(ms) < darkAlt;
    const okAt = (i: number) => model.samples[i].alt >= minAlt && model.sun[i] < darkAlt;
    let runStart: number | null = null;
    let bestLen = 0;
    const edge = (iPrev: number, iNext: number) =>
      bisectCrossing((ms) => (ok(ms) ? 1 : -1), model.samples[iPrev].t, model.samples[iNext].t);
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k];
      const good = okAt(i);
      if (good && runStart === null) {
        runStart = k === 0 ? Math.max(range.start, model.samples[i].t) : edge(idx[k - 1], i);
      }
      const last = k === idx.length - 1;
      if (runStart !== null && (!good || last)) {
        const runEnd = good ? model.samples[i].t : edge(idx[k - 1], i);
        if (runEnd - runStart > bestLen) {
          bestLen = runEnd - runStart;
          best = {
            start: runStart,
            end: runEnd,
            darkness: darkAlt === -18 ? "astro" : "nautical",
            moonUpFraction: 0,
            moonMinSep: null,
            peak: model.samples[i],
          };
        }
        runStart = null;
      }
    }
    if (best && bestLen < 60_000) best = null;
    if (best) {
      const b: BestWindow = best;
      const inside = model.samples.filter((s) => s.t >= b.start && s.t <= b.end);
      const edges = [b.start, b.end].map((t) => ({ ...model.samples[nearestSample(model, t)], t, alt: model.altAt(t) }));
      b.peak = [...edges, ...inside].reduce((p, s) => (s.alt > p.alt ? s : p));
    }
    if (best && model.moon) {
      let up = 0;
      let n = 0;
      let minSep: number | null = null;
      model.samples.forEach((s, i) => {
        if (s.t < best!.start || s.t > best!.end) return;
        n += 1;
        const m = model.moon![i];
        if (m.alt > 0) {
          up += 1;
          minSep = minSep === null ? m.sep : Math.min(minSep, m.sep);
        }
      });
      best.moonUpFraction = n ? up / n : 0;
      best.moonMinSep = minSep;
    }
  }

  let reason: NoBestReason | null = null;
  if (!best) {
    if (model.state === "never-rises") reason = "never-rises";
    else if (peak.alt <= 0) reason = "below-all-night";
    else if (peak.alt < minAlt) reason = "too-low";
    else if (darkAlt === null) reason = "no-dark";
    else reason = "not-in-dark";
  }
  return { range, peak, best, reason, minAlt };
}

// ── Text ───────────────────────────────────────────────────────────

export type Translate = (key: string, params?: Record<string, string | number>) => string;

/** The one-line summary under the chart, e.g.
 *  "Best 21:10–02:40, highest 72° at 23:55 (N)". */
export function chartSummary(
  model: AltitudeModel,
  a: NightAnalysis,
  fmt: (ms: number) => string,
  tr: Translate,
): string {
  const peak = {
    alt: Math.round(a.peak.alt),
    time: fmt(a.peak.t),
    dir: azimuthToCompassShort(a.peak.az),
    min: a.minAlt,
  };
  const parts: string[] = [];
  if (model.polar === "midnight-sun") parts.push(tr("chart.midnightSun"));
  if (model.polar === "polar-night") parts.push(tr("chart.polarNight"));
  if (a.best) {
    // "highest" means inside the window: where to point during it.
    const p = a.best.peak;
    parts.push(
      tr("chart.best", {
        start: fmt(a.best.start),
        end: fmt(a.best.end),
        alt: Math.round(p.alt),
        time: fmt(p.t),
        dir: azimuthToCompassShort(p.az),
      }),
    );
    if (a.best.darkness === "nautical") parts.push(tr("chart.nauticalOnly"));
    if (model.moon) {
      const illum = Math.round(model.moonIllum * 100);
      parts.push(
        a.best.moonUpFraction > 0 && a.best.moonMinSep !== null
          ? tr("chart.moonNote", { illum, sep: Math.round(a.best.moonMinSep) })
          : tr("chart.moonDown"),
      );
    }
  } else {
    switch (a.reason) {
      case "never-rises":
        parts.push(tr("chart.neverRises"));
        break;
      case "below-all-night":
        parts.push(tr("chart.belowAllNight"));
        break;
      case "too-low":
        parts.push(tr("chart.tooLow", peak));
        break;
      case "no-dark":
        parts.push(tr("chart.noDark", peak));
        break;
      default:
        parts.push(tr("chart.notInDark", peak));
    }
  }
  return parts.join(" · ");
}

// ── Clock ticks in a zone ────────────────────────────────────────

const partsCache = new Map<string, Intl.DateTimeFormat>();

/** Local hour and minute of `ms` on `zone`'s clock (device clock if undefined). */
export function zonedHourMinute(ms: number, zone?: string): { hour: number; minute: number } {
  const key = zone ?? "";
  let f = partsCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      ...(zone ? { timeZone: zone } : {}),
    });
    partsCache.set(key, f);
  }
  const parts = f.formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { hour: get("hour") % 24, minute: get("minute") };
}

/**
 * Instants between start and end where the zone's clock shows a whole hour.
 * Steps in 15 minutes, so half- and quarter-hour zones (Adelaide, Nepal)
 * and DST jumps land on the local hour, not the UTC one.
 */
export function hourTicks(start: number, end: number, zone?: string): { t: number; hour: number }[] {
  const out: { t: number; hour: number }[] = [];
  const q = 15 * 60_000;
  for (let ms = Math.ceil(start / q) * q; ms <= end; ms += q) {
    const { hour, minute } = zonedHourMinute(ms, zone);
    if (minute === 0) out.push({ t: ms, hour });
  }
  return out;
}

/** The sample index nearest `ms`. */
export function nearestSample(model: AltitudeModel, ms: number): number {
  const step = CURVE_STEP_MIN * 60_000;
  const i = Math.round((ms - model.span24.start) / step);
  return Math.max(0, Math.min(model.samples.length - 1, i));
}
