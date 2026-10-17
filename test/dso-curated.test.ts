import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyCuratedDSO,
  type CuratedDSO,
  type DSOEntry,
} from "../src/catalog/dso.ts";

const read = (name: string) =>
  JSON.parse(readFileSync(new URL(`../src/catalog/${name}`, import.meta.url), "utf8"));
const base = read("dso.json") as DSOEntry[];
const curated = read("dso-curated.json") as CuratedDSO;
const catalog = applyCuratedDSO(base, curated);
const byId = new Map(catalog.map((d) => [d.id, d]));

test("LMC, M45 and M40 are added with sources", () => {
  for (const id of ["LMC", "M45", "M40"]) {
    const entry = byId.get(id);
    assert.ok(entry, `${id} missing`);
    assert.match(entry.source ?? "", /OpenNGC addendum/);
  }
  assert.equal(byId.get("LMC")!.commonName, "Large Magellanic Cloud");
  assert.equal(byId.get("M45")!.commonName, "Pleiades");
  assert.equal(byId.get("M40")!.type, "double-star");
});

test("M102 is an alias: OpenNGC's M101, and NGC 5866 as the common alternative", () => {
  assert.ok(byId.get("M101")!.aliases?.includes("M102"));
  assert.ok(byId.get("NGC5866")!.aliases?.includes("M102"));
});

test("M42 is typed as a nebula and keeps its imported facts", () => {
  const m42 = byId.get("M42")!;
  assert.equal(m42.type, "hii-region");
  assert.ok(m42.notableFeatures.length >= 4);
  assert.ok(m42.description.length > 80);
});

test("raw OpenNGC Greek-letter names are replaced", () => {
  const raw = catalog.filter((d) =>
    /^(alf|bet|gam|del|eps|zet|eta|tet|iot|kap|lam|mu|nu|xi|omi|pi|rho|sig|tau|ups|phi|chi|psi|ome) [A-Z][a-z]{2}\b/.test(
      d.commonName,
    ),
  );
  assert.deepEqual(raw.map((d) => `${d.id}: ${d.commonName}`), []);
  assert.equal(byId.get("IC2602")!.commonName, "Southern Pleiades");
  assert.equal(byId.get("NGC2070")!.commonName, "Tarantula Nebula");
  assert.equal(byId.get("NGC0104")!.commonName, "47 Tucanae");
});

test("additions never shadow an imported entry, and the merge is pure", () => {
  const ids = catalog.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(catalog.length, base.length + curated.add.length);
  // The input array is untouched.
  assert.equal(base.find((d) => d.id === "M42")!.type, "open-cluster");
});
