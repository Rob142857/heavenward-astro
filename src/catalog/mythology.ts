/**
 * Constellation mythology — Joseph Campbell only, per explicit licensing terms:
 * every entry must trace to a specific, checkable passage in his published
 * work. Coverage is intentionally partial — Campbell was a comparative
 * mythologist, not a systematic star-catalog author, and the one book that
 * might have covered every constellation (Historical Atlas of World
 * Mythology, Vol. III) was left unwritten when he died in 1987. No entry
 * here should ever be treated as "this constellation has no myth" — it
 * means only that no citable Campbell passage was found; most constellations
 * (and all ~40 modern instrument-named ones like Microscopium or Telescopium)
 * simply have none to find.
 *
 * No astrology: every entry ties a constellation to a mythological figure or
 * story, never to zodiac/personality/horoscope content.
 */
export type MythologyConnectionStrength = "explicit" | "moderate" | "thin";

export interface MythologyEntry {
  /** IAU 3-letter constellation code, matching CelestialEvent.constellation. */
  constellation: string;
  figure: string;
  connectionStrength: MythologyConnectionStrength;
  summary: string;
  /**
   * Translations of `summary`, keyed by locale. These are OUR prose, so
   * unlike the verbatim Campbell quotations in quotes.ts they should be
   * translated — a French reader hitting an English paragraph mid-page in an
   * otherwise French app is a worse outcome than a translated summary.
   * Falls back to the English `summary` when a locale is missing.
   */
  summaryI18n?: Record<string, string>;
  source: string;
  sourceDetail: string;
}

/** The summary in the active locale, falling back to English. */
export function mythologySummary(entry: MythologyEntry, locale: string): string {
  return entry.summaryI18n?.[locale] ?? entry.summary;
}

let cache: MythologyEntry[] | null = null;
let byConstellation: Map<string, MythologyEntry> | null = null;

export async function loadMythologyCatalog(): Promise<MythologyEntry[]> {
  if (cache) return cache;
  const mod = await import("./mythology.json");
  cache = mod.default as MythologyEntry[];
  return cache;
}

/** O(1) lookup by IAU constellation code. Returns undefined for the ~80% of
 *  constellations with no sourced Campbell entry — callers must treat that
 *  as "say nothing," never as license to invent mythology. */
export async function getMythologyForConstellation(
  code: string | null,
): Promise<MythologyEntry | undefined> {
  if (!code) return undefined;
  const catalog = await loadMythologyCatalog();
  if (!byConstellation) {
    byConstellation = new Map(catalog.map((e) => [e.constellation, e]));
  }
  return byConstellation.get(code);
}
