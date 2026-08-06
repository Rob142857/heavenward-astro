/**
 * Historical astronomy — real, documented facts about how ancient cultures
 * observed and used the sky (calendars, agriculture, navigation), sourced
 * only from actual primary texts (translated inscriptions, cuneiform tablets,
 * classical poetry) or established peer-reviewed/academic scholarship. This
 * is deliberately separate from mythology.ts: no gods, heroes, or myths here,
 * and no astrology (zodiac/personality/horoscope framing) — just documented
 * practice. Coverage is intentionally partial and grows only when a fact
 * clears that bar; absence for a constellation means nothing was found, not
 * that nothing happened.
 */
export type HistorySourceType = "primary" | "academic";

export interface HistoryEntry {
  /** IAU 3-letter constellation code, matching CelestialEvent.constellation. */
  constellation: string;
  /** Set when the fact is really about one star within the constellation. */
  starName?: string;
  topic: string;
  summary: string;
  sourceType: HistorySourceType;
  source: string;
  sourceDetail: string;
}

let cache: HistoryEntry[] | null = null;
let byConstellation: Map<string, HistoryEntry[]> | null = null;

export async function loadHistoryCatalog(): Promise<HistoryEntry[]> {
  if (cache) return cache;
  const mod = await import("./history.json");
  cache = mod.default as HistoryEntry[];
  return cache;
}

/** A constellation can have more than one documented culture's account
 *  (e.g. Orion has both a Babylonian and an Egyptian entry) — returns all
 *  of them, or an empty array for the majority with no sourced entry yet. */
export async function getHistoryForConstellation(
  code: string | null,
): Promise<HistoryEntry[]> {
  if (!code) return [];
  const catalog = await loadHistoryCatalog();
  if (!byConstellation) {
    byConstellation = new Map();
    for (const entry of catalog) {
      const list = byConstellation.get(entry.constellation) ?? [];
      list.push(entry);
      byConstellation.set(entry.constellation, list);
    }
  }
  return byConstellation.get(code) ?? [];
}
