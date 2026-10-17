import test from "node:test";
import assert from "node:assert/strict";
import * as Astronomy from "astronomy-engine";
import {
  analyseNight,
  buildAltitudeModel,
  chartSummary,
  hourTicks,
} from "../src/engine/altitude-curve.ts";
import { getRiseSetForRaDec, getTwilightTimes } from "../src/engine/astro.ts";
import { formatClock } from "../src/services/sky-time.ts";

// Bellingen NSW, 20:30 AEDT on 18 Oct 2026 (the mobile suite's frozen clock).
const BELLINGEN = { lat: -30.45, lon: 152.9, elev: 0 };
const AT = new Date("2026-10-18T09:30:00Z");
const MIN = 60_000;

const M42 = { kind: "radec" as const, ra: 5.588, dec: -5.391 };
const LMC = { kind: "radec" as const, ra: 5.3929, dec: -69.756 };
const POLARIS = { kind: "radec" as const, ra: 2.5303, dec: 89.264 };

const echo = (key: string, p?: Record<string, string | number>) =>
  p ? `${key} ${JSON.stringify(p)}` : key;

test("samples are 5 minutes apart over 24 h around tonight", () => {
  const m = buildAltitudeModel(M42, BELLINGEN, AT);
  assert.ok(m.night, "Bellingen has a night");
  assert.ok(m.span24.start <= m.night!.start && m.span24.end >= m.night!.end);
  assert.ok(Math.abs(m.span24.end - m.span24.start - 24 * 60 * MIN) < 30 * MIN);
  assert.equal(m.samples[1].t - m.samples[0].t, 5 * MIN);
  assert.equal(m.samples.length, m.sun.length);
});

test("twilight band edges match the twilight bar (getTwilightTimes) to the minute", () => {
  const m = buildAltitudeModel(M42, BELLINGEN, AT);
  const tw = getTwilightTimes(BELLINGEN, AT);
  const edges = m.bands.slice(1).map((b) => b.from);
  const expected = [
    tw.sunset, tw.civilDusk, tw.nauticalDusk, tw.astronomicalDusk,
    tw.astronomicalDawn, tw.nauticalDawn, tw.civilDawn, tw.sunrise,
  ].map((d) => d!.getTime());
  assert.deepEqual(m.bands.map((b) => b.kind), [
    "day", "civil", "nautical", "astro", "dark", "astro", "nautical", "civil", "day",
  ]);
  edges.forEach((e, i) =>
    assert.ok(Math.abs(e - expected[i]) < MIN, `edge ${i}: ${new Date(e).toISOString()} vs ${new Date(expected[i]).toISOString()}`),
  );
});

test("transit matches an independent GMST reference (Meeus, Astronomical Algorithms, eq. 12.4)", () => {
  // Reference: Jean Meeus, Astronomical Algorithms, 2nd ed. (1998), eq. 12.4,
  // mean sidereal time at Greenwich. An object transits when local sidereal
  // time equals its right ascension. Solved here by fixed-point iteration,
  // with no astronomy-engine code involved.
  const lstDeg = (ms: number) => {
    const jd = ms / 86_400_000 + 2440587.5;
    const T = (jd - 2451545.0) / 36525;
    const gmst =
      280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * T * T - (T * T * T) / 38710000;
    return gmst + BELLINGEN.lon;
  };
  const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
  for (const target of [M42, LMC]) {
    const m = buildAltitudeModel(target, BELLINGEN, AT);
    let t = m.transit!;
    for (let k = 0; k < 4; k++) t -= (wrap180(lstDeg(t) - target.ra * 15) / 360.98564736629) * 86_400_000;
    assert.ok(Math.abs(m.transit! - t) < MIN, `transit ${new Date(m.transit!).toISOString()} vs ${new Date(t).toISOString()}`);
  }
  // By hand: GMST at 0h UT on 18 Oct is about 1.70 h, longitude adds 10.19 h,
  // so LST = RA (5.588 h) at UT (29.588 - 11.89) / 1.0027 = 17.65 h, i.e.
  // M42 transits about 04:35 AEDT on 19 Oct, at 90 - |-30.45 - -5.39| = 64.9°.
  const m42 = buildAltitudeModel(M42, BELLINGEN, AT);
  assert.ok(Math.abs(m42.transit! - Date.parse("2026-10-18T17:37:00Z")) < 5 * MIN, new Date(m42.transit!).toISOString());
  assert.ok(Math.abs(m42.transitAlt! - 64.9) < 0.3, String(m42.transitAlt));
});

test("planet transit matches astronomy-engine's own hour-angle search", () => {
  const m = buildAltitudeModel({ kind: "body", body: "Jupiter" }, BELLINGEN, AT);
  const obs = new Astronomy.Observer(BELLINGEN.lat, BELLINGEN.lon, 0);
  const ref = Astronomy.SearchHourAngle(Astronomy.Body.Jupiter, obs, 0, new Date(m.span24.start), +1);
  assert.ok(Math.abs(m.transit! - ref.time.date.getTime()) < 2 * MIN);
});

test("rise and set match the rise/set search that shares the sampler", () => {
  const m = buildAltitudeModel(M42, BELLINGEN, AT);
  assert.equal(m.state, "rises-sets");
  assert.ok(m.rise! < m.transit! && m.transit! < m.set!);
  const rs = getRiseSetForRaDec(M42.ra, M42.dec, BELLINGEN, AT);
  assert.equal(rs.samples[1].t - rs.samples[0].t, 5 * MIN);
  // getRiseSetForRaDec reports the first crossings in its own window; any
  // matching crossing must agree with the chart's to within a minute.
  for (const [a, b] of [[m.rise!, rs.rise!], [m.set!, rs.set!]]) {
    const days = Math.round((a - b.getTime()) / 86_164_091);
    assert.ok(Math.abs(a - b.getTime() - days * 86_164_091) < 2 * MIN);
  }
});

test("best window: M42 above 30° in full dark, edges on the limits", () => {
  const m = buildAltitudeModel(M42, BELLINGEN, AT);
  const a = analyseNight(m, 30);
  const tw = getTwilightTimes(BELLINGEN, AT);
  assert.ok(a.best, "M42 has a window");
  assert.equal(a.best!.darkness, "astro");
  assert.ok(a.best!.start >= tw.astronomicalDusk!.getTime() - MIN);
  assert.ok(a.best!.end <= tw.astronomicalDawn!.getTime() + MIN);
  // Each edge is where M42 crosses 30° or the Sun crosses -18°.
  for (const e of [a.best!.start, a.best!.end]) {
    const onAlt = Math.abs(m.altAt(e) - 30) < 0.1;
    const onSun = Math.abs(m.sunAltAt(e) + 18) < 0.1;
    assert.ok(onAlt || onSun, `edge ${new Date(e).toISOString()}`);
  }
  // M42 is still climbing towards its 04:35 transit when dawn ends the window.
  assert.ok(Math.abs(a.best!.end - tw.astronomicalDawn!.getTime()) < MIN);
  // A higher limit gives a shorter window; 70° gives none (peak 64.9°).
  const a50 = analyseNight(m, 50);
  assert.ok(a50.best!.end - a50.best!.start < a.best!.end - a.best!.start);
  const a70 = analyseNight(m, 70);
  assert.equal(a70.best, null);
  assert.equal(a70.reason, "too-low");
  // Moon interference is reported.
  assert.ok(a.best!.moonUpFraction >= 0 && a.best!.moonUpFraction <= 1);
});

test("circumpolar: the LMC never sets from Bellingen and has a window", () => {
  const m = buildAltitudeModel(LMC, BELLINGEN, AT);
  assert.equal(m.state, "always-up");
  assert.equal(m.rise, null);
  assert.equal(m.set, null);
  assert.ok(m.samples.every((s) => s.alt > 0));
  // Lowest at lower culmination: 69.76 - (90 - 30.45) = 10.2°.
  const low = Math.min(...m.samples.map((s) => s.alt));
  assert.ok(Math.abs(low - 10.2) < 0.5, String(low));
  assert.ok(analyseNight(m, 30).best);
});

test("never rises: Polaris from Bellingen has no rise, set or window", () => {
  const m = buildAltitudeModel(POLARIS, BELLINGEN, AT);
  assert.equal(m.state, "never-rises");
  assert.equal(m.rise, null);
  assert.equal(m.set, null);
  assert.ok(m.samples.every((s) => s.alt < 0));
  const a = analyseNight(m, 30);
  assert.equal(a.best, null);
  assert.equal(a.reason, "never-rises");
  assert.match(chartSummary(m, a, String, echo), /^chart\.neverRises/);
});

test("extreme latitudes: midnight sun, polar night and the poles do not break", () => {
  const tromso = { lat: 69.65, lon: 18.96, elev: 0 };
  const june = buildAltitudeModel({ kind: "radec", ra: 18.6, dec: 38.8 }, tromso, new Date("2026-06-21T20:00:00Z"));
  assert.equal(june.night, null);
  assert.equal(june.polar, "midnight-sun");
  assert.ok(june.bands.every((b) => b.kind === "day"));
  const aJune = analyseNight(june, 30);
  assert.equal(aJune.best, null);
  assert.equal(aJune.reason, "no-dark");
  assert.match(chartSummary(june, aJune, String, echo), /chart\.midnightSun/);

  const dec = buildAltitudeModel({ kind: "radec", ra: 2.5303, dec: 89.264 }, tromso, new Date("2026-12-21T20:00:00Z"));
  assert.equal(dec.polar, "polar-night");
  assert.equal(dec.state, "always-up");
  const aDec = analyseNight(dec, 30);
  assert.ok(aDec.best, "Polaris is high all polar night");

  for (const lat of [89.9, -89.9]) {
    const m = buildAltitudeModel({ kind: "body", body: "Moon" }, { lat, lon: 0, elev: 0 }, AT);
    assert.equal(m.isMoon, true);
    assert.equal(m.moon, null);
    assert.ok(m.samples.length > 280);
    analyseNight(m, 30);
  }
});

test("hour ticks follow the zone's clock: Perth, Adelaide (+10:30) and the DST jump", () => {
  const start = Date.parse("2026-10-18T08:00:00Z");
  const end = Date.parse("2026-10-18T19:00:00Z");
  const perth = hourTicks(start, end, "Australia/Perth");
  assert.ok(perth.every((k) => new Date(k.t).getUTCMinutes() === 0));
  assert.equal(perth[0].hour, 16); // 08:00Z = 16:00 AWST
  const adelaide = hourTicks(start, end, "Australia/Adelaide");
  assert.ok(adelaide.every((k) => new Date(k.t).getUTCMinutes() === 30));
  // Sydney clocks went 02:00 -> 03:00 on 4 Oct 2026: hour 2 never appears.
  const dst = hourTicks(Date.parse("2026-10-03T12:00:00Z"), Date.parse("2026-10-03T18:00:00Z"), "Australia/Sydney");
  assert.deepEqual(dst.map((k) => k.hour), [22, 23, 0, 1, 3, 4, 5]);
});

test("the summary prints on the linked zone's clock", () => {
  const m = buildAltitudeModel(M42, BELLINGEN, AT);
  const a = analyseNight(m, 30);
  const syd = chartSummary(m, a, (ms) => formatClock(new Date(ms), "Australia/Sydney", "en-GB"), echo);
  const per = chartSummary(m, a, (ms) => formatClock(new Date(ms), "Australia/Perth", "en-GB"), echo);
  const end = formatClock(new Date(a.best!.end), "Australia/Sydney", "en-GB");
  const endPerth = formatClock(new Date(a.best!.end), "Australia/Perth", "en-GB");
  assert.ok(syd.includes(`"end":"${end}"`), syd);
  assert.ok(per.includes(`"end":"${endPerth}"`), per);
  assert.notEqual(end, endPerth);
  assert.match(syd, /^chart\.best .*"dir":"N"/);
});
