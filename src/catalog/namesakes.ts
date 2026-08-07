/**
 * Namesakes — things down here that carry a star's name: ships, rockets,
 * telescopes, aircraft, a public holiday. The sky threading back into human
 * life, which is the whole point of the app.
 *
 * These are exactly the facts a 1B model will invent with total confidence
 * ("the Sirius Corporation was founded in..."), so nothing here is left to
 * the model's memory. Every entry names the thing, says why the name was
 * chosen, and cites where that reason is on record. Where a naming story is
 * only ever repeated second-hand and never stated by the people who did the
 * naming, it is marked "widely-reported" rather than "documented", and the
 * prose says who is doing the reporting.
 *
 * Deliberately excluded: folklore. The oft-repeated claim that Lockheed named
 * its whole fleet after stars is true only for Electra; Vega, Sirius and Altair
 * have no such corporate record. The Mira supercomputer is named from the Latin
 * "to wonder", not the star. Neither is here.
 *
 * Coverage is thin on purpose — 18 entries against ~5,000 stars. Absence means
 * nothing was found that clears the bar, never that nothing exists.
 */
export type NamesakeConfidence = "documented" | "widely-reported";

export interface NamesakeEntry {
  /**
   * Proper star names this belongs to, matching `name` in stars.json exactly.
   * A list because some names honour a group: the Pleiades namesakes (Subaru,
   * Matariki) attach to every catalogued member, and constellation-named
   * things (Orion, Gemini) attach to that constellation's two or three famous
   * stars rather than to all ~200 objects inside its borders — which would
   * put the Orion capsule on every anonymous smudge in the Sword.
   */
  stars: string[];
  thing: string;
  summary: string;
  /** Translations of `thing`/`summary` by locale — our prose, so translated.
   *  Falls back to English when a locale is missing. */
  thingI18n?: Record<string, string>;
  summaryI18n?: Record<string, string>;
  /** "documented" = the namer said so on the record. "widely-reported" = the
   *  derivation is consistently attested but not in the namer's own words. */
  confidence: NamesakeConfidence;
  source: string;
}

export function namesakeThing(entry: NamesakeEntry, locale: string): string {
  return entry.thingI18n?.[locale] ?? entry.thing;
}

export function namesakeSummary(entry: NamesakeEntry, locale: string): string {
  return entry.summaryI18n?.[locale] ?? entry.summary;
}

let cache: NamesakeEntry[] | null = null;
let byStar: Map<string, NamesakeEntry[]> | null = null;

export async function loadNamesakeCatalog(): Promise<NamesakeEntry[]> {
  if (cache) return cache;
  const mod = await import("./namesakes.json");
  cache = mod.default as NamesakeEntry[];
  return cache;
}

/** Lookup by proper star name. Case-insensitive because the name reaching us
 *  may have come from a search box or a URL, not from stars.json. Returns an
 *  empty array for the overwhelming majority of stars. */
export async function getNamesakesForStar(
  starName: string | null | undefined,
): Promise<NamesakeEntry[]> {
  if (!starName) return [];
  const catalog = await loadNamesakeCatalog();
  if (!byStar) {
    byStar = new Map();
    for (const entry of catalog) {
      for (const star of entry.stars) {
        const key = star.toLowerCase();
        const list = byStar.get(key) ?? [];
        list.push(entry);
        byStar.set(key, list);
      }
    }
  }
  return byStar.get(starName.trim().toLowerCase()) ?? [];
}
