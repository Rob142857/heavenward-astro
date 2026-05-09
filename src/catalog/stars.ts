export interface StarEntry {
  id: string;
  name: string;
  ra: number;
  dec: number;
  magnitude: number;
  absMagnitude: number;
  spectralType: string;
  constellation: string;
  distanceLY: number | null;
  distancePC: number | null;
  colorIndex: number | null;
  luminosity: string | null;
  isDouble: boolean;
  doubleCompanion: string | null;
  isVariable: boolean;
  variableType: string | null;
  variablePeriod: string | null;
  hasExoplanets: boolean;
  exoplanetCount: number;
  exoplanetNotes: string | null;
  mass: string | null;
  radius: string | null;
  temperature: number | null;
  age: string | null;
  description: string;
  notableFeatures: string[];
  properMotion: string | null;
  bayerDesignation: string | null;
  flamsteedNumber: string | null;
}

let cache: StarEntry[] | null = null;

export async function loadStarCatalog(): Promise<StarEntry[]> {
  if (cache) return cache;
  const mod = await import("./stars.json");
  cache = mod.default as StarEntry[];
  return cache;
}
