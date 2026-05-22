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
    | "galaxy-group";
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
}

let cache: DSOEntry[] | null = null;
let byId: Map<string, DSOEntry> | null = null;

export async function loadDSOCatalog(): Promise<DSOEntry[]> {
  if (cache) return cache;
  const mod = await import("./dso.json");
  cache = mod.default as DSOEntry[];
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
