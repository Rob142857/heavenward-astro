import test from "node:test";
import assert from "node:assert/strict";
import * as Astronomy from "astronomy-engine";
import {
  getNightWindow,
  getNightRiseSetForRaDec,
  getNightRiseSetForBody,
} from "../src/engine/astro.ts";

// Bellingen NSW, 20:30 AEDT on 18 Oct 2026 (the mobile suite's frozen clock).
const BELLINGEN = { lat: -30.45, lon: 152.9, elev: 0 };
const AT = new Date("2026-10-18T09:30:00Z");
const night = getNightWindow(BELLINGEN, AT);
const inWindow = (d: Date) =>
  d.getTime() >= night.start.getTime() && d.getTime() <= night.end.getTime();

test("tonight's window runs from this evening's sunset to tomorrow's sunrise", () => {
  // Sunset about 19:00 AEDT (08:00Z), sunrise about 05:50 AEDT (18:50Z).
  assert.ok(Math.abs(night.start.getTime() - Date.parse("2026-10-18T08:00:00Z")) < 20 * 60_000);
  assert.ok(Math.abs(night.end.getTime() - Date.parse("2026-10-18T18:50:00Z")) < 20 * 60_000);
  // The same night whether asked at 2 pm or at 3 am.
  const afternoon = getNightWindow(BELLINGEN, new Date("2026-10-18T03:00:00Z"));
  const smallHours = getNightWindow(BELLINGEN, new Date("2026-10-18T16:00:00Z"));
  assert.equal(afternoon.start.getTime(), night.start.getTime());
  assert.equal(smallHours.end.getTime(), night.end.getTime());
});

test("Canopus rises tonight (about 20:00 AEDT) and does not set before dawn", () => {
  // RA 6h24m, Dec -52.7°. Reference by hand: semi-diurnal arc
  // acos(-tan φ tan δ) = 9.37 h, so it rises at LST ~21.0 h, about 20:00 AEDT,
  // and sets about 14:20 tomorrow, after sunrise. The old 36-hour search
  // showed "↑07:56 PM ↓03:01 PM" on one card.
  const rs = getNightRiseSetForRaDec(6.3992, -52.696, BELLINGEN, night);
  assert.equal(rs.state, "rises-sets");
  assert.deepEqual(rs.events.map((e) => e.kind), ["rise"]);
  assert.equal(rs.set, null);
  assert.ok(Math.abs(rs.rise!.getTime() - Date.parse("2026-10-18T09:00:00Z")) < 20 * 60_000, rs.rise!.toISOString());
});

test("an object that sets in the evening and rises before dawn is listed set-then-rise", () => {
  // Dec -57° is up about 20.7 h a day here; at RA 12.67 h it sets mid-evening
  // and is back before dawn.
  const rs = getNightRiseSetForRaDec(12.67, -57, BELLINGEN, night);
  assert.equal(rs.state, "rises-sets");
  assert.deepEqual(rs.events.map((e) => e.kind), ["set", "rise"]);
  assert.ok(rs.set! < rs.rise!);
  for (const e of rs.events) assert.ok(inWindow(e.at));
});

test("Acrux is circumpolar from Bellingen and Polaris never rises", () => {
  // Circumpolar south of Dec -(90 - 30.45) = -59.55°.
  const acrux = getNightRiseSetForRaDec(12.4433, -63.099, BELLINGEN, night);
  assert.equal(acrux.state, "always-up");
  assert.deepEqual(acrux.events, []);
  const polaris = getNightRiseSetForRaDec(2.5303, 89.264, BELLINGEN, night);
  assert.equal(polaris.state, "never-rises");
});

test("an object below the horizon all night but not never-rising", () => {
  // Near the Sun's RA in October (13.5 h), Dec 0: up by day, down all night.
  const rs = getNightRiseSetForRaDec(13.5, 0, BELLINGEN, night);
  assert.equal(rs.state, "down-all-night");
  assert.equal(rs.rise, null);
  assert.equal(rs.set, null);
});

test("planet rise and set fall inside tonight and in order", () => {
  for (const body of [Astronomy.Body.Jupiter, Astronomy.Body.Moon, Astronomy.Body.Saturn]) {
    const rs = getNightRiseSetForBody(body, BELLINGEN, night);
    for (const e of rs.events) assert.ok(inWindow(e.at), `${body} ${e.kind} ${e.at.toISOString()}`);
    const times = rs.events.map((e) => e.at.getTime());
    assert.deepEqual(times, [...times].sort((a, b) => a - b));
    if (rs.events.length === 0) assert.match(rs.state, /up-all-night|down-all-night/);
  }
});
