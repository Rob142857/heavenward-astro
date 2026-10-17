import test from "node:test";
import assert from "node:assert/strict";
import {
  parseSkyLink,
  hasSkyLink,
  stripSkyLink,
  zonedTimeToUtc,
} from "../src/services/deep-link.ts";

test("lat and lng set a visit-only location", () => {
  const link = parseSkyLink("?lat=-31.95&lng=115.86");
  assert.deepEqual(link.location, { lat: -31.95, lon: 115.86, elev: 0 });
  assert.equal(link.at, null);
});

test("lon is accepted as an alias for lng", () => {
  assert.deepEqual(parseSkyLink("?lat=10&lon=20").location, {
    lat: 10,
    lon: 20,
    elev: 0,
  });
});

test("out-of-range, missing, blank or 0,0 positions are ignored", () => {
  for (const q of [
    "?lat=91&lng=10",
    "?lat=10&lng=181",
    "?lat=10",
    "?lat=&lng=5",
    "?lat=abc&lng=5",
    "?lat=0&lng=0",
  ]) {
    assert.equal(parseSkyLink(q).location, null, q);
  }
});

test("date + time + tz give the exact UTC instant (Perth, UTC+8, no DST)", () => {
  const { at } = parseSkyLink(
    "?date=2026-11-10&time=21:30&tz=Australia/Perth",
  );
  assert.equal(at?.toISOString(), "2026-11-10T13:30:00.000Z");
  assert.equal(
    parseSkyLink("?date=2026-11-10&time=21:30&tz=Australia/Perth").zone,
    "Australia/Perth",
  );
  assert.equal(parseSkyLink("?tz=Australia/Perth").zone, null);
});

test("Sydney in daylight saving time is UTC+11", () => {
  const { at } = parseSkyLink(
    "?date=2026-11-10&time=21:30&tz=Australia/Sydney",
  );
  assert.equal(at?.toISOString(), "2026-11-10T10:30:00.000Z");
});

test("Brisbane has no daylight saving (UTC+10)", () => {
  const { at } = parseSkyLink(
    "?date=2026-11-10&time=21:30&tz=Australia/Brisbane",
  );
  assert.equal(at?.toISOString(), "2026-11-10T11:30:00.000Z");
});

test("time defaults to 21:00 and a bad time falls back to 21:00", () => {
  assert.equal(
    parseSkyLink("?date=2026-11-10&tz=Australia/Perth").at?.toISOString(),
    "2026-11-10T13:00:00.000Z",
  );
  assert.equal(
    parseSkyLink("?date=2026-11-10&time=25:99&tz=Australia/Perth").at?.toISOString(),
    "2026-11-10T13:00:00.000Z",
  );
});

test("impossible dates are rejected", () => {
  assert.equal(parseSkyLink("?date=2026-02-30").at, null);
  assert.equal(parseSkyLink("?date=10-11-2026").at, null);
  assert.equal(parseSkyLink("?date=").at, null);
});

test("an unknown time zone falls back to the browser's own clock", () => {
  const { at } = parseSkyLink("?date=2026-11-10&time=21:30&tz=Mars/Olympus");
  assert.ok(at instanceof Date);
  assert.equal(at.getHours(), 21);
  assert.equal(at.getMinutes(), 30);
});

test("zonedTimeToUtc handles the day after the Sydney DST start", () => {
  // DST starts 4 Oct 2026 02:00 AEST -> 03:00 AEDT.
  assert.equal(
    zonedTimeToUtc(2026, 10, 3, 12, 0, "Australia/Sydney").toISOString(),
    "2026-10-03T02:00:00.000Z",
  );
  assert.equal(
    zonedTimeToUtc(2026, 10, 5, 12, 0, "Australia/Sydney").toISOString(),
    "2026-10-05T01:00:00.000Z",
  );
});

test("hasSkyLink and stripSkyLink keep the rest of the URL", () => {
  assert.equal(hasSkyLink("?lat=1&lng=2"), true);
  assert.equal(hasSkyLink("?utm=1"), false);
  assert.equal(
    stripSkyLink(
      "https://sky.example/?lat=1&lng=2&date=2026-11-10&time=21:00&tz=Australia/Perth&keep=1#/",
    ),
    "/?keep=1#/",
  );
});
