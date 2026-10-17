import test from "node:test";
import assert from "node:assert/strict";
import { parseSkyLink } from "../src/services/deep-link.ts";
import {
  formatClock,
  viewTime,
  viewZone,
  zonedDayKey,
  zonedMonthDay,
} from "../src/services/sky-time.ts";
import { getAltAzForRaDec, getTwilightTimes } from "../src/engine/astro.ts";

// M42 from src/catalog/dso.json (OpenNGC): RA 5h35m17s, Dec -5°23'.
const M42 = { ra: 5.5881, dec: -5.391 };

function linkCtx(search: string) {
  const link = parseSkyLink(search);
  return { location: link.location!, at: link.at, atZone: link.zone };
}

// Fixed reference cases at 30.7°S 152.98°E. Expected altitudes were checked
// against an independent calculation (Meeus GMST -> hour angle -> altitude,
// no refraction): 63.7°, -39.4° and 57.5°. In June the Sun sits about half an
// hour of RA east of M42, so at noon M42 is high in a daylight sky; it is
// well below the horizon by 21:00.
function m42Altitude(search: string, iso: string): number {
  const ctx = linkCtx(search);
  const at = viewTime(ctx);
  assert.equal(at.toISOString(), iso);
  return getAltAzForRaDec(M42.ra, M42.dec, ctx.location, at).altitude;
}
const near = (actual: number, expected: number, tol = 1) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${actual} vs ${expected}`);

test("a June-noon link computes M42 for 12:00 AEST, not the device's now", () => {
  // 12:00 AEST (UTC+10, no DST in June) is 02:00 UTC.
  near(
    m42Altitude(
      "?lat=-30.7&lng=152.98&date=2026-06-20&time=12:00&tz=Australia/Sydney",
      "2026-06-20T02:00:00.000Z",
    ),
    63.7,
  );
});

test("a June 21:00 link puts M42 below the horizon", () => {
  near(
    m42Altitude(
      "?lat=-30.7&lng=152.98&date=2026-06-20&time=21:00&tz=Australia/Sydney",
      "2026-06-20T11:00:00.000Z",
    ),
    -39.2,
  );
});

test("a December 23:00 link gives a different altitude", () => {
  // 23:00 AEDT (UTC+11) is 12:00 UTC.
  near(
    m42Altitude(
      "?lat=-30.7&lng=152.98&date=2026-12-20&time=23:00&tz=Australia/Sydney",
      "2026-12-20T12:00:00.000Z",
    ),
    57.5,
  );
});

test("without a link the view time is now", () => {
  const before = Date.now();
  const at = viewTime({}).getTime();
  assert.ok(at >= before && at <= Date.now());
  assert.equal(viewZone({}), undefined);
});

test("Perth twilight prints on the Perth clock whatever the device zone", () => {
  // Reference: timeanddate.com, Perth, 10 Nov 2026: sunset 6:49 pm AWST.
  const ctx = linkCtx(
    "?lat=-31.95&lng=115.86&date=2026-11-10&time=21:30&tz=Australia/Perth",
  );
  const tw = getTwilightTimes(ctx.location, viewTime(ctx));
  const sunset = formatClock(tw.sunset, viewZone(ctx), "en-GB");
  const [h, m] = sunset.split(":").map(Number);
  const minutes = h * 60 + m;
  assert.ok(Math.abs(minutes - (18 * 60 + 49)) <= 2, `sunset ${sunset}`);
  // The same instant on the Sydney clock is three hours later.
  const sydney = formatClock(tw.sunset, "Australia/Sydney", "en-GB");
  assert.equal(Number(sydney.split(":")[0]) - h, 3);
});

test("calendar day follows the link's zone, not UTC", () => {
  // 23:30 AEDT on 31 Dec is still 31 Dec in Sydney but 12:30 UTC.
  const at = new Date("2026-12-31T12:30:00Z");
  assert.deepEqual(zonedMonthDay(at, "Australia/Sydney"), { month: 12, day: 31 });
  // 00:30 AEDT on 1 Jan is 13:30 UTC on 31 Dec.
  const newYear = new Date("2026-12-31T13:30:00Z");
  assert.deepEqual(zonedMonthDay(newYear, "Australia/Sydney"), { month: 1, day: 1 });
  assert.equal(zonedDayKey(newYear, "Australia/Sydney"), "2027-01-01");
  assert.equal(zonedDayKey(newYear, "UTC"), "2026-12-31");
});
