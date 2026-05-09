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
  size: number; // arcminutes
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
}

let cache: DSOEntry[] | null = null;

export async function loadDSOCatalog(): Promise<DSOEntry[]> {
  if (cache) return cache;
  const mod = await import("./dso.json");
  cache = mod.default as DSOEntry[];
  return cache;
}
