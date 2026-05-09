export interface DSOEntry {
  id: string;
  name: string;
  commonName: string;
  type:
    | "galaxy"
    | "nebula"
    | "cluster"
    | "planetary-nebula"
    | "supernova-remnant";
  ra: number;
  dec: number;
  magnitude: number;
  size: number; // arcminutes
  constellation: string;
}

let cache: DSOEntry[] | null = null;

export async function loadDSOCatalog(): Promise<DSOEntry[]> {
  if (cache) return cache;
  const mod = await import("./dso.json");
  cache = mod.default as DSOEntry[];
  return cache;
}
