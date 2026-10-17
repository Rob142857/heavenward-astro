import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyCuratedDSO, type DSOEntry } from "../src/catalog/dso.ts";
import type { StarEntry } from "../src/catalog/stars.ts";
import {
  bayerForms,
  catalogKey,
  dsoToEntry,
  normalizeText,
  planetEntry,
  rankMatches,
  starToEntry,
  type SearchEntry,
} from "../src/services/search-core.ts";

const read = (name: string) =>
  JSON.parse(readFileSync(new URL(`../src/catalog/${name}`, import.meta.url), "utf8"));
const dsos = applyCuratedDSO(read("dso.json"), read("dso-curated.json")) as DSOEntry[];
const stars = read("stars.json") as StarEntry[];
const index: SearchEntry[] = [
  ...stars.map(starToEntry),
  ...dsos.map(dsoToEntry),
  ...["Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune"].map(
    (n) => planetEntry(n, "Planet"),
  ),
];
const first = (q: string) => rankMatches(index, q)[0]?.id;

test("normalizeText folds case, accents, punctuation and Greek letters", () => {
  assert.equal(normalizeText("  Boötes "), "bootes");
  assert.equal(normalizeText("De Mairan's Nebula"), "de mairans nebula");
  assert.equal(normalizeText("α Cen"), "alpha cen");
  assert.equal(normalizeText("θ¹ Ori"), "theta 1 ori");
});

test("catalogKey makes IDs with spaces and leading zeros compare equal", () => {
  for (const q of ["m 42", "M42", "messier 42", "M042"]) assert.equal(catalogKey(q), "m42");
  for (const q of ["ngc 292", "NGC0292", "ngc 0292", "NGC292"]) assert.equal(catalogKey(q), "ngc292");
  for (const q of ["c80", "C 80", "Caldwell 80"]) assert.equal(catalogKey(q), "c80");
  assert.equal(catalogKey("Mel 22"), "mel22");
  assert.equal(catalogKey("ngc 5866b"), "ngc5866b");
  assert.equal(catalogKey("orion"), null);
  assert.equal(catalogKey("m"), null);
});

test("bayerForms spells out Greek letters and genitives", () => {
  assert.deepEqual(bayerForms("Alp-1", "Cen"), [
    "alpha cen",
    "alpha centauri",
    "alpha1 cen",
    "alpha1 centauri",
  ]);
  assert.deepEqual(bayerForms("Bet", "Ori"), ["beta ori", "beta orionis"]);
  assert.deepEqual(bayerForms(null, "Ori"), []);
});

// The v-next 1 acceptance queries, against the real catalogue.
const EXPECTED: [string, string][] = [
  ["m 42", "dso-M42"],
  ["M42", "dso-M42"],
  ["ngc 292", "dso-NGC0292"],
  ["ngc292", "dso-NGC0292"],
  ["c80", "dso-NGC5139"],
  ["lmc", "dso-LMC"],
  ["large magellanic", "dso-LMC"],
  ["tarantula", "dso-NGC2070"],
  ["pleiades", "dso-M45"],
  ["m45", "dso-M45"],
  ["southern pleiades", "dso-IC2602"],
  ["alpha centauri", "star-rigil-kentaurus"],
  ["horsehead", "dso-IC0434"],
  ["m40", "dso-M40"],
  ["m102", "dso-M101"],
  ["jupiter", "planet-jupiter"],
  ["saturn", "planet-saturn"],
  ["omega centauri", "dso-NGC5139"],
  ["jewel box", "dso-NGC4755"],
  ["47 tuc", "dso-NGC0104"],
];
for (const [q, id] of EXPECTED) {
  test(`"${q}" finds ${id} first`, () => {
    assert.equal(first(q), id);
  });
}

test("planets rank above objects named after them", () => {
  const ids = rankMatches(index, "jupiter").map((e) => e.id);
  assert.equal(ids[0], "planet-jupiter");
  assert.ok(ids.length > 1, "Jupiter's Ghost Nebula should still match");
});

test('"orion" finds at least 10 objects including Rigel and M43, near the top', () => {
  const ids = rankMatches(index, "orion").map((e) => e.id);
  assert.ok(ids.length >= 10, `only ${ids.length}`);
  const top = ids.slice(0, 50);
  assert.ok(top.includes("star-rigel"), "Rigel not in the first 50");
  assert.ok(top.includes("dso-M43"), "M43 not in the first 50");
  assert.ok(top.includes("dso-M42"), "M42 not in the first 50");
});

test("M102 also offers NGC 5866, the common alternative", () => {
  const ids = rankMatches(index, "m102").map((e) => e.id);
  assert.deepEqual(ids.slice(0, 2), ["dso-M101", "dso-NGC5866"]);
});

test("an empty query lists everything, brightest named first", () => {
  assert.equal(rankMatches(index, "").length, index.length);
});
