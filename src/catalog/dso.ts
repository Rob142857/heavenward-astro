export interface DSOEntry {
  id: string;
  name: string;
  commonName: string;
  type:
    | "galaxy"
    | "nebula"
    | "cluster"
    | "planetary-nebula"
    | "supernova-remnant"
    | "globular-cluster"
    | "open-cluster"
    | "emission-nebula"
    | "reflection-nebula"
    | "dark-nebula"
    | "hii-region"
    | "galaxy-pair"
    | "galaxy-group"
    | "double-star";
  ra: number;
  dec: number;
  magnitude: number;
  bMagnitude: number | null;
  size: number; // major axis in arcminutes
  minorAxis: number | null; // arcminutes
  positionAngle: number | null; // degrees, north-eastward
  constellation: string;
  distanceLY: number | null;
  distancePC: number | null;
  description: string;
  physicalSize: string | null; // e.g. "110,000 ly diameter"
  surfaceBrightness: number | null;
  notableFeatures: string[];
  subObjects: string[];
  discoverer: string | null;
  yearDiscovered: number | null;
  morphology: string | null;
  bestSeason: string | null;
  imagingNotes: string | null;
  /** Caldwell catalog designation (e.g. "C14"), if this object is a Caldwell. */
  caldwell: string | null;
  /** Other names search should find it by (curated, dso-curated.json). */
  aliases?: string[];
  /** Where a curated entry's figures come from. */
  source?: string;
}

/** dso-curated.json: additions and corrections over the generated dso.json. */
export interface CuratedDSO {
  add: DSOEntry[];
  override: Record<string, Partial<DSOEntry>>;
}

/**
 * Merge the curated file over the importer's output. Pure, so it can be
 * tested in Node. Scalar fields replace; `aliases` and `notableFeatures`
 * are appended (deduplicated) so a correction never drops imported facts.
 * Added entries never replace an id the importer already produced.
 */
export function applyCuratedDSO(
  base: DSOEntry[],
  curated: CuratedDSO,
): DSOEntry[] {
  const out = base.map((entry) => {
    const patch = curated.override[entry.id];
    if (!patch) return entry;
    const merged: DSOEntry = { ...entry, ...patch };
    for (const key of ["aliases", "notableFeatures"] as const) {
      if (patch[key]) {
        merged[key] = [...new Set([...(entry[key] ?? []), ...patch[key]!])];
      }
    }
    return merged;
  });
  const ids = new Set(out.map((entry) => entry.id));
  for (const extra of curated.add) {
    if (!ids.has(extra.id)) out.push(extra);
  }
  return out;
}

let cache: DSOEntry[] | null = null;
let byId: Map<string, DSOEntry> | null = null;

export async function loadDSOCatalog(): Promise<DSOEntry[]> {
  if (cache) return cache;
  const [mod, curated] = await Promise.all([
    import("./dso.json"),
    import("./dso-curated.json"),
  ]);
  cache = applyCuratedDSO(
    mod.default as DSOEntry[],
    curated.default as unknown as CuratedDSO,
  );
  return cache;
}

/** O(1) lookup by id. Builds the index on first call. */
export async function getDSOById(id: string): Promise<DSOEntry | undefined> {
  const catalog = await loadDSOCatalog();
  if (!byId) {
    byId = new Map<string, DSOEntry>();
    for (const d of catalog) byId.set(d.id, d);
  }
  return byId.get(id);
}
