export interface StarEntry {
  id: string;
  name: string;
  ra: number;
  dec: number;
  magnitude: number;
  spectralType: string;
  constellation: string;
}

let cache: StarEntry[] | null = null;

export async function loadStarCatalog(): Promise<StarEntry[]> {
  if (cache) return cache;
  const mod = await import("./stars.json");
  cache = mod.default as StarEntry[];
  return cache;
}
