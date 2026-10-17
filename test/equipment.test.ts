import test from "node:test";
import assert from "node:assert/strict";
import {
  bestMonth,
  brightnessScore,
  equipmentClass,
  seasonFor,
  surfaceBrightness,
  type VisualTarget,
} from "../src/engine/equipment.ts";

const dso = (mag: number, size: number, minor: number | null, dsoType: string, sb: number | null = null): VisualTarget => ({
  kind: "dso",
  mag,
  size,
  minor,
  dsoType,
  surfaceBrightness: sb,
});

test("surface brightness: catalogue figure first, else from magnitude and area", () => {
  assert.equal(surfaceBrightness(dso(3.4, 177.8, 69.7, "galaxy", 23.63)), 23.63);
  // mag 10 over a 1' circle: 10 + 2.5 log10(pi/4 * 3600) = 18.63
  assert.ok(Math.abs(surfaceBrightness(dso(10, 1, 1, "galaxy"))! - 18.63) < 0.01);
  assert.equal(surfaceBrightness(dso(10, 0, null, "nebula")), null);
});

test("equipment class of known objects", () => {
  // Catalogue figures for M42, M31, M33, M51, M101.
  assert.equal(equipmentClass(dso(4, 90, 60, "hii-region")), "naked-eye", "M42");
  assert.equal(equipmentClass(dso(3.4, 177.8, 69.7, "galaxy", 23.63)), "naked-eye", "M31");
  assert.equal(equipmentClass(dso(5.8, 62.1, 36.7, "galaxy", 23.61)), "binoculars", "M33");
  assert.equal(equipmentClass(dso(8.4, 13.7, 11.7, "galaxy", 22.9)), "small-scope", "M51");
  assert.equal(equipmentClass(dso(13.2, 2, 1, "galaxy", 23)), "smart-scope", "faint NGC galaxy");
  assert.equal(equipmentClass(dso(11, 10, 8, "galaxy", 25)), "smart-scope", "low surface brightness");
  // A 0.5' planetary nebula looks like a star without magnification.
  assert.equal(equipmentClass(dso(8, 0.5, 0.4, "planetary-nebula")), "small-scope");
  assert.equal(equipmentClass({ kind: "planet", mag: 0.7 }), "naked-eye", "Saturn");
  assert.equal(equipmentClass({ kind: "planet", mag: 7.8 }), "binoculars", "Neptune");
  assert.equal(equipmentClass({ kind: "moon", mag: -10 }), "naked-eye");
  assert.equal(equipmentClass({ kind: "star", mag: 3.1, needs: "small-scope" }), "small-scope", "Albireo");
});

test("brightness score by type: planets full, clusters by magnitude, galaxies by both", () => {
  assert.equal(brightnessScore({ kind: "planet", mag: 7.8 }, "naked-eye"), 1);
  assert.equal(brightnessScore(dso(4, 20, null, "open-cluster"), "binoculars"), 1);
  assert.equal(brightnessScore(dso(6, 20, null, "open-cluster"), "binoculars"), 0.5);
  const galaxy = brightnessScore(dso(6, 30, 20, "galaxy", 22.5), "binoculars");
  assert.equal(galaxy, (0.5 + 0.5) / 2);
  // Bigger equipment, easier target.
  assert.ok(brightnessScore(dso(8, 10, 8, "galaxy"), "smart-scope") > brightnessScore(dso(8, 10, 8, "galaxy"), "binoculars"));
});

test("best month: the month the object transits at midnight", () => {
  assert.equal(bestMonth(5.588, -5.39, -30.45), 12, "M42: December");
  assert.equal(bestMonth(13.447, -47.48, -30.45), 4, "Omega Centauri: April");
  assert.equal(bestMonth(0.712, 41.27, 51.5), 10, "M31 from London: October");
  assert.equal(bestMonth(2.53, 89.26, -30.45), null, "Polaris never rises from Bellingen");
  assert.equal(bestMonth(5.39, -69.76, 51.5), null, "LMC never rises from London");
});

test("season word follows the hemisphere", () => {
  assert.equal(seasonFor(12, -30), "summer");
  assert.equal(seasonFor(12, 40), "winter");
  assert.equal(seasonFor(4, -30), "autumn");
  assert.equal(seasonFor(10, 51), "autumn");
});
