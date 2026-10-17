import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyCuratedDSO, type DSOEntry } from "../src/catalog/dso.ts";
import { SHOWPIECE_DOUBLES } from "../src/catalog/doubles.ts";
import { analyseNight, buildAltitudeModel } from "../src/engine/altitude-curve.ts";
import { getTwilightTimes } from "../src/engine/astro.ts";
import {
  BEST_GROUPS,
  SCORE_WEIGHTS,
  buildCandidates,
  isPinned,
  isShowpiece,
  moonCloseness,
  moonExcludes,
  moonPenalty,
  moonSensitivity,
  passesFilters,
  rankTonightsBest,
  scoreParts,
  totalScore,
  whyParts,
  type BestCandidate,
} from "../src/engine/tonight-best.ts";

// Bellingen NSW, 18 Oct 2026. 20:30 AEDT is the mobile suite's frozen clock;
// 14:00 AEDT is the same night seen as a daytime plan.
const BELLINGEN = { lat: -30.45, lon: 152.9, elev: 0 };
const EVENING = new Date("2026-10-18T09:30:00Z");
const AFTERNOON = new Date("2026-10-18T03:00:00Z");
const HOUR = 3_600_000;

const dsos = applyCuratedDSO(
  JSON.parse(readFileSync("src/catalog/dso.json", "utf8")) as DSOEntry[],
  JSON.parse(readFileSync("src/catalog/dso-curated.json", "utf8")),
);
const stars = JSON.parse(readFileSync("src/catalog/stars.json", "utf8"));
const CANDS = buildCandidates(dsos, stars, SHOWPIECE_DOUBLES);
const byId = (id: string) => {
  const c = CANDS.find((x) => x.id === id);
  assert.ok(c, `candidate ${id}`);
  return c;
};

// ── Score: documented weights ───────────────────────────────────────

test("score weights are the documented ones and sum to 100", () => {
  assert.deepEqual({ ...SCORE_WEIGHTS }, { time: 30, peak: 20, moon: 20, brightness: 20, cloud: 10 });
  const sum = Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.equal(sum, 100);
  assert.equal(totalScore({ time: 1, peak: 1, moon: 1, brightness: 1, cloud: 1 }), 100);
  assert.equal(totalScore({ time: 0, peak: 0, moon: 0, brightness: 0, cloud: 0 }), 0);
  // Each part contributes exactly its weight.
  assert.equal(totalScore({ time: 1, peak: 0, moon: 0, brightness: 0, cloud: 0 }), 30);
  assert.equal(totalScore({ time: 0, peak: 0, moon: 0, brightness: 0, cloud: 1 }), 10);
  // Parts are clamped to 0-1.
  assert.equal(totalScore({ time: 2, peak: -1, moon: 0, brightness: 0, cloud: 0 }), 30);
});

test("score parts: hours over 4, peak above the minimum, cloud neutral when unknown", () => {
  const m42 = byId("dso-M42");
  const base = { hours: 2, peakAlt: 60, moonUpFraction: 0, moonMinSep: null, moonIllum: 0.5, cloudMean: null };
  const p = scoreParts(base, m42, { minAlt: 30, equipment: "binoculars" });
  assert.equal(p.time, 0.5);
  assert.equal(p.peak, 0.5);
  assert.equal(p.moon, 1, "Moon down: no penalty");
  assert.equal(p.cloud, 1, "no forecast changes no order");
  assert.equal(scoreParts({ ...base, hours: 6 }, m42, { minAlt: 30, equipment: "binoculars" }).time, 1);
  assert.equal(scoreParts({ ...base, peakAlt: 30 }, m42, { minAlt: 30, equipment: "binoculars" }).peak, 0);
  assert.ok(Math.abs(scoreParts({ ...base, cloudMean: 0.4 }, m42, { minAlt: 30, equipment: "binoculars" }).cloud - 0.6) < 1e-9);
});

// ── Moon penalty ────────────────────────────────────────────────────

test("Moon penalty: none when down or new, full when bright and close", () => {
  assert.equal(moonPenalty(1, 1, 0, 5), 0, "Moon down");
  assert.equal(moonPenalty(1, 0, 1, 5), 0, "new Moon");
  assert.equal(moonPenalty(1, 1, 1, 5), 1, "full Moon within 10°");
  assert.equal(moonPenalty(1, 1, 1, 120), 0.25, "full Moon far away still brightens the sky");
  assert.equal(moonPenalty(0, 1, 1, 5), 0, "planets don't care");
});

test("Moon penalty grows as the Moon gets closer, brighter and up longer", () => {
  assert.ok(moonPenalty(1, 0.8, 1, 20) > moonPenalty(1, 0.8, 1, 60));
  assert.ok(moonPenalty(1, 0.9, 1, 40) > moonPenalty(1, 0.3, 1, 40));
  assert.ok(moonPenalty(1, 0.9, 1, 40) > moonPenalty(1, 0.9, 0.3, 40));
  assert.equal(moonCloseness(10), 1);
  assert.equal(moonCloseness(50), 1 - 0.75 * 0.5);
  assert.equal(moonCloseness(90), 0.25);
});

test("Moon sensitivity by type", () => {
  assert.equal(moonSensitivity(byId("dso-M31")), 1, "galaxy");
  assert.equal(moonSensitivity(byId("dso-M42")), 1, "nebula");
  assert.equal(moonSensitivity(byId("dso-M57")), 0.5, "planetary nebula");
  assert.equal(moonSensitivity(byId("dso-NGC5139")), 0.5, "globular");
  assert.equal(moonSensitivity(byId("dso-M45")), 0.3, "open cluster");
  assert.equal(moonSensitivity(byId("star-albireo")), 0.1, "double");
  assert.equal(moonSensitivity(byId("planet-jupiter")), 0, "planet");
});

test("bright Moon too close drops diffuse targets only", () => {
  // Full Moon, up the whole window: limit is 10 + 30 = 40°.
  assert.equal(moonExcludes(1, 1, 1, 30), true);
  assert.equal(moonExcludes(1, 1, 1, 45), false);
  // New Moon: only within 10°.
  assert.equal(moonExcludes(1, 0, 1, 15), false);
  // Up for under half the window: kept (penalised instead).
  assert.equal(moonExcludes(1, 1, 0.4, 5), false);
  // Clusters ride it out.
  assert.equal(moonExcludes(0.3, 1, 1, 5), false);
});

// ── Filters ─────────────────────────────────────────────────────────

test("type filter keeps only the chosen groups; empty means all", () => {
  const m31 = byId("dso-M31");
  const m45 = byId("dso-M45");
  assert.equal(passesFilters(m31, { groups: ["galaxies"], equipment: "smart-scope" }), true);
  assert.equal(passesFilters(m45, { groups: ["galaxies"], equipment: "smart-scope" }), false);
  assert.equal(passesFilters(m45, { groups: [], equipment: "smart-scope" }), true);
  assert.equal(byId("dso-M42").group, "nebulae");
  assert.equal(byId("dso-NGC5139").group, "clusters");
  assert.equal(byId("moon").group, "planets");
});

test("equipment filter: an object shows with its class and anything bigger", () => {
  const m51 = byId("dso-M51");
  assert.equal(passesFilters(m51, { groups: [], equipment: "naked-eye" }), false);
  assert.equal(passesFilters(m51, { groups: [], equipment: "binoculars" }), false);
  assert.equal(passesFilters(m51, { groups: [], equipment: "small-scope" }), true);
  assert.equal(passesFilters(m51, { groups: [], equipment: "smart-scope" }), true);
  // Albireo is mag 3 but 35" apart: it needs a telescope to split.
  const albireo = byId("star-albireo");
  assert.equal(passesFilters(albireo, { groups: [], equipment: "binoculars" }), false);
  assert.equal(passesFilters(albireo, { groups: [], equipment: "small-scope" }), true);
});

test("candidate pool: showpieces only, no star-polluted nebulae, curated doubles", () => {
  const ids = new Set(CANDS.map((c) => c.id));
  assert.ok(ids.has("dso-M42") && ids.has("dso-LMC") && ids.has("dso-M45"));
  // "gam Cyg" (IC 1318) and "Alnilam" (NGC 1990) carry their star's magnitude.
  assert.ok(!ids.has("dso-IC1318"));
  assert.ok(!ids.has("dso-NGC1990"));
  // HYG flags Sirius and Fomalhaut as doubles; no one splits them at the eyepiece.
  assert.ok(!ids.has("star-sirius") && !ids.has("star-fomalhaut"));
  assert.ok(ids.has("star-albireo") && ids.has("star-acrux"));
  const faint = dsos.find((d) => /^NGC/.test(d.id) && !d.commonName && !d.caldwell)!;
  assert.equal(isShowpiece(faint), false);
  assert.ok(CANDS.filter((c) => c.group === "planets").length === 8);
});

// ── The list from Bellingen ─────────────────────────────────────────

const tw = getTwilightTimes(BELLINGEN, EVENING);
const night = rankTonightsBest(CANDS, BELLINGEN, EVENING);

test("Bellingen 18 Oct: at most 15 rows, Moon and naked-eye planets pinned first", () => {
  assert.ok(night.rows.length >= 10 && night.rows.length <= 15, `${night.rows.length} rows`);
  const firstOther = night.rows.findIndex((r) => !r.pinned);
  assert.ok(firstOther > 0, "something pinned");
  assert.ok(night.rows.slice(0, firstOther).every((r) => isPinned(r.cand)));
  assert.ok(night.rows.slice(firstOther).every((r) => !isPinned(r.cand)));
  // Uranus and Neptune are binocular targets: ranked, not pinned.
  for (const id of ["planet-uranus", "planet-neptune"]) assert.equal(isPinned(byId(id)), false);
  assert.equal(isPinned(byId("planet-saturn")), true);
  assert.ok(night.rows.some((r) => r.cand.id === "moon"), "the 49% Moon is up in the evening");
  // Within each block, best score first.
  for (const block of [night.rows.slice(0, firstOther), night.rows.slice(firstOther)])
    for (let i = 1; i < block.length; i++) assert.ok(block[i - 1].score >= block[i].score);
});

test("every deep-sky row is at least 30° for at least 1 h of astronomical dark", () => {
  const dusk = tw.astronomicalDusk!.getTime();
  const dawn = tw.astronomicalDawn!.getTime();
  for (const r of night.rows.filter((x) => x.cand.pos.kind === "radec")) {
    assert.ok(r.end - r.start >= HOUR - 60_000, `${r.cand.name} ${(r.end - r.start) / HOUR} h`);
    assert.ok(r.start >= dusk - 60_000 && r.end <= dawn + 60_000, `${r.cand.name} inside dark`);
    // Checked against the object page's own model, independently.
    const m = buildAltitudeModel(r.cand.pos, BELLINGEN, EVENING);
    for (const t of [r.start + 60_000, (r.start + r.end) / 2, r.end - 60_000])
      assert.ok(m.altAt(t) >= 30 - 0.05, `${r.cand.name} at ${new Date(t).toISOString()}`);
    const a = analyseNight(m, 30);
    assert.equal(a.best?.start, r.start, `${r.cand.name} window matches its page`);
  }
});

test("no type takes more than 5 rows when all types show", () => {
  const counts = new Map<string, number>();
  for (const r of night.rows) if (r.cand.group !== "planets") counts.set(r.cand.group, (counts.get(r.cand.group) ?? 0) + 1);
  for (const [g, n] of counts) assert.ok(n <= 5, `${g}: ${n}`);
});

test("at 2 pm the list is tonight's plan, the same as at 8:30 pm", () => {
  const plan = rankTonightsBest(CANDS, BELLINGEN, AFTERNOON);
  assert.deepEqual(plan.rows.map((r) => r.cand.id), night.rows.map((r) => r.cand.id));
  assert.ok(plan.rows[0].start > AFTERNOON.getTime(), "windows are later today");
});

test("filters narrow the list: galaxies only, naked eye only", () => {
  const gal = rankTonightsBest(CANDS, BELLINGEN, EVENING, { groups: ["galaxies"], equipment: "smart-scope" });
  assert.ok(gal.rows.length > 5);
  assert.ok(gal.rows.every((r) => r.cand.group === "galaxies"));
  // One type showing: no 5-row cap.
  assert.ok(gal.rows.length > 5);
  const eye = rankTonightsBest(CANDS, BELLINGEN, EVENING, { equipment: "naked-eye" });
  assert.ok(eye.rows.every((r) => r.needs === "naked-eye"), eye.rows.map((r) => `${r.cand.name}:${r.needs}`).join());
  assert.ok(eye.rows.some((r) => r.cand.id === "dso-LMC"));
});

test("a nearer Moon lowers the same target's score", () => {
  const cand: BestCandidate = byId("dso-M33");
  const far = scoreParts({ hours: 3, peakAlt: 40, moonUpFraction: 1, moonMinSep: 120, moonIllum: 0.9, cloudMean: null }, cand, { minAlt: 30, equipment: "binoculars" });
  const near = scoreParts({ hours: 3, peakAlt: 40, moonUpFraction: 1, moonMinSep: 25, moonIllum: 0.9, cloudMean: null }, cand, { minAlt: 30, equipment: "binoculars" });
  assert.ok(totalScore(near) < totalScore(far));
});

test("why line starts with the dark hours and mentions the Moon", () => {
  const row = night.rows.find((r) => r.cand.pos.kind === "radec")!;
  const parts = whyParts(row, { minAlt: 30, equipment: "binoculars" });
  assert.equal(parts[0].key, "best.why.darkHours");
  assert.equal(parts[0].params?.min, 30);
  assert.ok(parts.some((p) => p.key.startsWith("best.why.moon")));
  const moonRow = night.rows.find((r) => r.cand.id === "moon")!;
  assert.equal(whyParts(moonRow, { minAlt: 30, equipment: "binoculars" })[0].key, "best.why.twilightHours");
});

test("sparkline: altitude every 15 minutes from sunset to sunrise", () => {
  const r = night.rows[0];
  assert.ok(r.spark.length > 30);
  assert.equal(r.spark[1].t - r.spark[0].t, 15 * 60_000);
  assert.ok(r.spark[0].t >= tw.sunset!.getTime() - 5 * 60_000);
  assert.ok(r.spark.at(-1)!.t <= tw.sunrise!.getTime() + 5 * 60_000);
});

test("groups list matches the filter chips", () => {
  assert.deepEqual(BEST_GROUPS, ["planets", "galaxies", "nebulae", "clusters", "doubles"]);
});
