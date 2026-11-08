// Writes dist/mcp-catalog.json: the compact star + deep-sky list the /mcp
// Function looks targets up in (via env.ASSETS), so the Function bundle stays
// small and the numbers come from the same catalogue the app shows.
// Runs after `vite build`. Row: [id, name, commonName, aliases, kind, ra, dec, mag, size, minor, pa].
import { readFileSync, writeFileSync } from "node:fs";
import { applyCuratedDSO, type CuratedDSO, type DSOEntry } from "../src/catalog/dso.ts";

const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const dso = applyCuratedDSO(read("../src/catalog/dso.json") as DSOEntry[], read("../src/catalog/dso-curated.json") as CuratedDSO);
const stars = read("../src/catalog/stars.json") as { id: string; name: string; ra: number; dec: number; magnitude: number }[];

const r = (n: number | null | undefined, dp: number) => (typeof n === "number" && Number.isFinite(n) ? Number(n.toFixed(dp)) : null);
const rows: unknown[] = [];
for (const d of dso) {
  rows.push([d.id, d.name, d.commonName || "", d.aliases ?? [], d.type, r(d.ra, 5), r(d.dec, 4), r(d.magnitude, 2), r(d.size, 2), r(d.minorAxis, 2), r(d.positionAngle, 0)]);
}
for (const s of stars) {
  rows.push([s.id, s.name, "", [], "star", r(s.ra, 5), r(s.dec, 4), r(s.magnitude, 2), null, null, null]);
}
const out = new URL("../dist/mcp-catalog.json", import.meta.url);
writeFileSync(out, JSON.stringify(rows));
console.log(`mcp-catalog.json: ${rows.length} targets`);
