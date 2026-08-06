/**
 * IAU three-letter constellation abbreviations to full names.
 *
 * The star and DSO catalogs store the abbreviation ("Aqr"), while the
 * solar-system engine reports the full name ("Aquarius"). Detail pages were
 * building Wikipedia links straight from whatever they had, so every one of
 * the ~10,000 star and DSO pages linked to a page that does not exist
 * ("Aqr_(constellation)") while planet pages happened to work. This map is
 * the single place that difference gets resolved.
 *
 * Note Se1/Se2: the catalog splits Serpens into its two disjoint halves —
 * Caput (the head) and Cauda (the tail), the only constellation on the sky
 * in two separate pieces. Both resolve to Serpens for linking, since
 * Wikipedia treats it as one article.
 */
const CONSTELLATION_NAMES: Record<string, string> = {
  And: "Andromeda",
  Ant: "Antlia",
  Aps: "Apus",
  Aql: "Aquila",
  Aqr: "Aquarius",
  Ara: "Ara",
  Ari: "Aries",
  Aur: "Auriga",
  Boo: "Boötes",
  CMa: "Canis Major",
  CMi: "Canis Minor",
  CVn: "Canes Venatici",
  Cae: "Caelum",
  Cam: "Camelopardalis",
  Cap: "Capricornus",
  Car: "Carina",
  Cas: "Cassiopeia",
  Cen: "Centaurus",
  Cep: "Cepheus",
  Cet: "Cetus",
  Cha: "Chamaeleon",
  Cir: "Circinus",
  Cnc: "Cancer",
  Col: "Columba",
  Com: "Coma Berenices",
  CrA: "Corona Australis",
  CrB: "Corona Borealis",
  Crt: "Crater",
  Cru: "Crux",
  Crv: "Corvus",
  Cyg: "Cygnus",
  Del: "Delphinus",
  Dor: "Dorado",
  Dra: "Draco",
  Equ: "Equuleus",
  Eri: "Eridanus",
  For: "Fornax",
  Gem: "Gemini",
  Gru: "Grus",
  Her: "Hercules",
  Hor: "Horologium",
  Hya: "Hydra",
  Hyi: "Hydrus",
  Ind: "Indus",
  LMi: "Leo Minor",
  Lac: "Lacerta",
  Leo: "Leo",
  Lep: "Lepus",
  Lib: "Libra",
  Lup: "Lupus",
  Lyn: "Lynx",
  Lyr: "Lyra",
  Men: "Mensa",
  Mic: "Microscopium",
  Mon: "Monoceros",
  Mus: "Musca",
  Nor: "Norma",
  Oct: "Octans",
  Oph: "Ophiuchus",
  Ori: "Orion",
  Pav: "Pavo",
  Peg: "Pegasus",
  Per: "Perseus",
  Phe: "Phoenix",
  Pic: "Pictor",
  PsA: "Piscis Austrinus",
  Psc: "Pisces",
  Pup: "Puppis",
  Pyx: "Pyxis",
  Ret: "Reticulum",
  Scl: "Sculptor",
  Sco: "Scorpius",
  Sct: "Scutum",
  Se1: "Serpens",
  Se2: "Serpens",
  Ser: "Serpens",
  Sex: "Sextans",
  Sge: "Sagitta",
  Sgr: "Sagittarius",
  Tau: "Taurus",
  Tel: "Telescopium",
  TrA: "Triangulum Australe",
  Tri: "Triangulum",
  Tuc: "Tucana",
  UMa: "Ursa Major",
  UMi: "Ursa Minor",
  Vel: "Vela",
  Vir: "Virgo",
  Vol: "Volans",
  Vul: "Vulpecula",
};

/** Reverse lookup, built once, so a full name coming from the solar-system
 *  engine can be resolved back to the code the myth/history catalogs key on. */
let codesByName: Map<string, string> | null = null;

/**
 * Full display name for a constellation value, which may already be a full
 * name (planets, Moon) or a three-letter code (stars, DSOs). Unknown values
 * are passed through unchanged rather than blanked — showing "Aqr" is worse
 * than showing "Aquarius" but far better than showing nothing.
 */
export function constellationName(value: string | null): string | null {
  if (!value) return null;
  return CONSTELLATION_NAMES[value] ?? value;
}

/** The IAU code for a constellation value in either form, or null if it
 *  isn't a constellation we know. Used to key the mythology/history lookups
 *  consistently regardless of which catalog the object came from. */
export function constellationCode(value: string | null): string | null {
  if (!value) return null;
  if (CONSTELLATION_NAMES[value]) return value;
  if (!codesByName) {
    codesByName = new Map();
    for (const [code, name] of Object.entries(CONSTELLATION_NAMES)) {
      // First code wins, so Serpens resolves to Se1 rather than the aliases.
      if (!codesByName.has(name)) codesByName.set(name, code);
    }
  }
  return codesByName.get(value) ?? null;
}

/** The Wikipedia article title for a constellation, in either input form. */
export function constellationWikiTitle(value: string | null): string | null {
  const name = constellationName(value);
  return name ? `${name} (constellation)` : null;
}
