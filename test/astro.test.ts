import test from "node:test";
import assert from "node:assert/strict";
import { getTwilightTimes } from "../src/engine/astro.ts";

// Reference: timeanddate.com, Perth, November 2026
// (https://www.timeanddate.com/sun/australia/perth?month=11&year=2026):
// 10 Nov sunset 6:49 pm, astronomical twilight ends 8:20 pm AWST (UTC+8);
// the night ends 03:39-03:40 on 11 Nov. Before the fix the dusk came from the
// previous evening and the night was reported as about 31 hours.
const PERTH = { lat: -31.95, lon: 115.86, elev: 0 };
const minutesFrom = (date: Date | null, iso: string) =>
  Math.abs((date?.getTime() ?? 0) - Date.parse(iso)) / 60_000;

for (const [label, at] of [
  ["afternoon", "2026-11-10T08:00:00Z"],
  ["after dusk", "2026-11-10T13:30:00Z"],
  ["after midnight", "2026-11-10T18:00:00Z"],
] as const) {
  test(`twilight pairs tonight's dusk with tomorrow's dawn (${label})`, () => {
    const t = getTwilightTimes(PERTH, new Date(at));
    assert.ok(minutesFrom(t.sunset, "2026-11-10T10:49:00Z") <= 3, String(t.sunset));
    assert.ok(minutesFrom(t.astronomicalDusk, "2026-11-10T12:20:00Z") <= 3, String(t.astronomicalDusk));
    assert.ok(minutesFrom(t.astronomicalDawn, "2026-11-10T19:39:00Z") <= 3, String(t.astronomicalDawn));
    assert.ok(t.nightDurationHours > 7 && t.nightDurationHours < 7.6, String(t.nightDurationHours));
  });
}
