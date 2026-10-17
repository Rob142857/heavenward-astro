/**
 * Search matching and ranking, kept free of DOM and catalog imports so it can
 * be tested in Node (test/search-core.test.ts).
 *
 * - normalizeText: lower case, no accents or punctuation, Greek letters
 *   spelled out ("α Cen" -> "alpha cen").
 * - catalogKey: one canonical form for catalogue IDs, so "M 42", "m42",
 *   "NGC 0292", "ngc292", "C80", "Caldwell 80" and "Mel 22" all compare equal.
 * - rankMatches: exact ID or alias, then name prefix, then word prefix, then
 *   substring (including the constellation's full name, so "orion" finds
 *   Rigel). Within a tier: planets and the Moon first, then named objects,
 *   then brightness.
 */

import type { DSOEntry } from "../catalog/dso.ts";
import type { StarEntry } from "../catalog/stars.ts";

export type SearchKind = "planet" | "moon" | "star" | "dso" | "meteor";

export interface Searchable {
  kind: SearchKind;
  name: string;
  magnitude: number | null;
  /** Normalised exact keys: catalogue keys, aliases, the name. */
  keys: string[];
  /** Normalised display names and aliases, for prefix matching. */
  names: string[];
  /** Normalised blob for substring matching. */
  text: string;
  /** Messier/Caldwell/common-named DSO, or a star with a proper name. */
  notable: boolean;
}

const GREEK: Record<string, string> = {
  α: "alpha", β: "beta", γ: "gamma", δ: "delta", ε: "epsilon", ζ: "zeta",
  η: "eta", θ: "theta", ι: "iota", κ: "kappa", λ: "lambda", μ: "mu",
  ν: "nu", ξ: "xi", ο: "omicron", π: "pi", ρ: "rho", σ: "sigma",
  τ: "tau", υ: "upsilon", φ: "phi", χ: "chi", ψ: "psi", ω: "omega",
};

/** HYG/OpenNGC three-letter Greek abbreviations ("Alp", "tet"). */
const GREEK_ABBR: Record<string, string> = {
  alp: "alpha", alf: "alpha", bet: "beta", gam: "gamma", del: "delta",
  eps: "epsilon", zet: "zeta", eta: "eta", the: "theta", tet: "theta",
  iot: "iota", kap: "kappa", lam: "lambda", mu: "mu", nu: "nu", xi: "xi",
  omi: "omicron", pi: "pi", rho: "rho", sig: "sigma", tau: "tau",
  ups: "upsilon", phi: "phi", chi: "chi", psi: "psi", ome: "omega",
};

/** IAU abbreviation -> [name, genitive]. */
export const CONSTELLATIONS: Record<string, [string, string]> = {
  And: ["Andromeda", "Andromedae"], Ant: ["Antlia", "Antliae"],
  Aps: ["Apus", "Apodis"], Aql: ["Aquila", "Aquilae"],
  Aqr: ["Aquarius", "Aquarii"], Ara: ["Ara", "Arae"],
  Ari: ["Aries", "Arietis"], Aur: ["Auriga", "Aurigae"],
  Boo: ["Bootes", "Bootis"], CMa: ["Canis Major", "Canis Majoris"],
  CMi: ["Canis Minor", "Canis Minoris"], CVn: ["Canes Venatici", "Canum Venaticorum"],
  Cae: ["Caelum", "Caeli"], Cam: ["Camelopardalis", "Camelopardalis"],
  Cap: ["Capricornus", "Capricorni"], Car: ["Carina", "Carinae"],
  Cas: ["Cassiopeia", "Cassiopeiae"], Cen: ["Centaurus", "Centauri"],
  Cep: ["Cepheus", "Cephei"], Cet: ["Cetus", "Ceti"],
  Cha: ["Chamaeleon", "Chamaeleontis"], Cir: ["Circinus", "Circini"],
  Cnc: ["Cancer", "Cancri"], Col: ["Columba", "Columbae"],
  Com: ["Coma Berenices", "Comae Berenices"], CrA: ["Corona Australis", "Coronae Australis"],
  CrB: ["Corona Borealis", "Coronae Borealis"], Crt: ["Crater", "Crateris"],
  Cru: ["Crux", "Crucis"], Crv: ["Corvus", "Corvi"],
  Cyg: ["Cygnus", "Cygni"], Del: ["Delphinus", "Delphini"],
  Dor: ["Dorado", "Doradus"], Dra: ["Draco", "Draconis"],
  Equ: ["Equuleus", "Equulei"], Eri: ["Eridanus", "Eridani"],
  For: ["Fornax", "Fornacis"], Gem: ["Gemini", "Geminorum"],
  Gru: ["Grus", "Gruis"], Her: ["Hercules", "Herculis"],
  Hor: ["Horologium", "Horologii"], Hya: ["Hydra", "Hydrae"],
  Hyi: ["Hydrus", "Hydri"], Ind: ["Indus", "Indi"],
  LMi: ["Leo Minor", "Leonis Minoris"], Lac: ["Lacerta", "Lacertae"],
  Leo: ["Leo", "Leonis"], Lep: ["Lepus", "Leporis"],
  Lib: ["Libra", "Librae"], Lup: ["Lupus", "Lupi"],
  Lyn: ["Lynx", "Lyncis"], Lyr: ["Lyra", "Lyrae"],
  Men: ["Mensa", "Mensae"], Mic: ["Microscopium", "Microscopii"],
  Mon: ["Monoceros", "Monocerotis"], Mus: ["Musca", "Muscae"],
  Nor: ["Norma", "Normae"], Oct: ["Octans", "Octantis"],
  Oph: ["Ophiuchus", "Ophiuchi"], Ori: ["Orion", "Orionis"],
  Pav: ["Pavo", "Pavonis"], Peg: ["Pegasus", "Pegasi"],
  Per: ["Perseus", "Persei"], Phe: ["Phoenix", "Phoenicis"],
  Pic: ["Pictor", "Pictoris"], PsA: ["Piscis Austrinus", "Piscis Austrini"],
  Psc: ["Pisces", "Piscium"], Pup: ["Puppis", "Puppis"],
  Pyx: ["Pyxis", "Pyxidis"], Ret: ["Reticulum", "Reticuli"],
  Scl: ["Sculptor", "Sculptoris"], Sco: ["Scorpius", "Scorpii"],
  Sct: ["Scutum", "Scuti"], Se1: ["Serpens", "Serpentis"],
  Se2: ["Serpens", "Serpentis"], Ser: ["Serpens", "Serpentis"],
  Sex: ["Sextans", "Sextantis"], Sge: ["Sagitta", "Sagittae"],
  Sgr: ["Sagittarius", "Sagittarii"], Tau: ["Taurus", "Tauri"],
  Tel: ["Telescopium", "Telescopii"], TrA: ["Triangulum Australe", "Trianguli Australis"],
  Tri: ["Triangulum", "Trianguli"], Tuc: ["Tucana", "Tucanae"],
  UMa: ["Ursa Major", "Ursae Majoris"], UMi: ["Ursa Minor", "Ursae Minoris"],
  Vel: ["Vela", "Velorum"], Vir: ["Virgo", "Virginis"],
  Vol: ["Volans", "Volantis"], Vul: ["Vulpecula", "Vulpeculae"],
};

export function normalizeText(s: string): string {
  return s
    .replace(/[αβγδεζηθικλμνξοπρστυφχψω]/gi, (c) => ` ${GREEK[c.toLowerCase()] ?? c} `)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[¹²³]/g, (c) => ({ "¹": "1", "²": "2", "³": "3" })[c] ?? c)
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const CATALOG_PREFIX: Record<string, string> = {
  m: "m", messier: "m",
  ngc: "ngc",
  ic: "ic",
  c: "c", caldwell: "c",
  mel: "mel", melotte: "mel",
  cr: "cr", collinder: "cr",
  b: "b", barnard: "b",
};

/**
 * Canonical catalogue key ("ngc292", "m42", "c80") for a query or an ID,
 * or null if the text is not a catalogue designation. Leading zeros and
 * spaces are ignored; a trailing component letter is kept ("ngc5866b").
 */
export function catalogKey(s: string): string | null {
  const m = /^(messier|ngc|ic|caldwell|melotte|mel|collinder|cr|barnard|m|c|b)\s*0*(\d+)\s*([a-z])?$/.exec(
    normalizeText(s),
  );
  if (!m) return null;
  return `${CATALOG_PREFIX[m[1]]}${m[2]}${m[3] ?? ""}`;
}

/** Name forms for a star's Bayer designation: "alpha centauri", "alpha cen". */
export function bayerForms(
  bayer: string | null | undefined,
  constellation: string,
): string[] {
  if (!bayer) return [];
  const m = /^([A-Za-z]{2,3})(?:-(\d))?$/.exec(bayer.trim());
  if (!m) return [];
  const letter = GREEK_ABBR[m[1].toLowerCase()];
  if (!letter) return [];
  const genitive = CONSTELLATIONS[constellation]?.[1];
  const abbr = constellation.toLowerCase();
  const out = [`${letter} ${abbr}`];
  if (genitive) out.push(`${letter} ${normalizeText(genitive)}`);
  if (m[2]) {
    out.push(`${letter}${m[2]} ${abbr}`);
    if (genitive) out.push(`${letter}${m[2]} ${normalizeText(genitive)}`);
  }
  return out;
}

/** "Ori" -> "orion orionis", for substring search. */
export function constellationWords(code: string): string {
  const c = CONSTELLATIONS[code];
  return c ? normalizeText(`${c[0]} ${c[1]}`) : "";
}

/**
 * How well `e` matches the normalised query: 0 exact ID/alias/name,
 * 1 name prefix, 2 word prefix in a name, 3 substring anywhere, -1 none.
 */
export function matchTier(e: Searchable, q: string, qKey: string | null): number {
  if (!q) return 3;
  if (e.keys.includes(q) || (qKey !== null && e.keys.includes(qKey))) return 0;
  if (e.names.some((n) => n.startsWith(q))) return 1;
  if (e.names.some((n) => n.includes(` ${q}`))) return 2;
  if (e.text.includes(q)) return 3;
  // Every word present, in any order ("cluster jewel").
  const words = q.split(" ");
  if (words.length > 1 && words.every((w) => e.text.includes(w))) return 3;
  return -1;
}

const KIND_ORDER: Record<SearchKind, number> = {
  planet: 0,
  moon: 0,
  meteor: 2,
  star: 2,
  dso: 2,
};

/** Matching entries for `query`, best first. */
export function rankMatches<T extends Searchable>(
  entries: T[],
  query: string,
): T[] {
  const q = normalizeText(query);
  const qKey = catalogKey(query);
  const scored: { e: T; tier: number }[] = [];
  for (const e of entries) {
    const tier = matchTier(e, q, qKey);
    if (tier >= 0) scored.push({ e, tier });
  }
  scored.sort(
    (a, b) =>
      a.tier - b.tier ||
      KIND_ORDER[a.e.kind] - KIND_ORDER[b.e.kind] ||
      Number(b.e.notable) - Number(a.e.notable) ||
      (a.e.magnitude ?? 99) - (b.e.magnitude ?? 99) ||
      a.e.name.localeCompare(b.e.name),
  );
  return scored.map((s) => s.e);
}

/* ── Index entries (built here so tests use the real catalogue) ── */

export interface SearchEntry extends Searchable {
  id: string; // detail-route id (e.g. "dso-M1", "star-sirius", "planet-mars")
  brief: string;
  constellation: string;
  catalogType: string | null;
  /** Lower-cased blob for chip keyword matching. */
  searchText: string;
  flags: Set<string>;
  ra: number | null; // hours
  dec: number | null; // degrees
}

export const uniq = (xs: (string | null | undefined)[]): string[] => [
  ...new Set(xs.filter((x): x is string => Boolean(x))),
];

/** Bayer-style catalogue names ("Bet Lup", "Alp-1 Cen") are not proper names. */
const DESIGNATION_NAME =
  /^[A-Z][a-z]{1,2}(?:-\d)? [A-Z][A-Za-z]{2}$|^\d+ [A-Z][A-Za-z]{2}$|^(?:HR|HIP|HD|Gl|GJ)\s?\d/;

export function starToEntry(s: StarEntry): SearchEntry {
  const flags = new Set<string>(["star"]);
  if (s.isDouble) flags.add("double");
  if (s.isVariable) flags.add("variable");
  if (s.hasExoplanets) flags.add("exoplanet-host");

  const name = normalizeText(s.name);
  const bayer = bayerForms(s.bayerDesignation, s.constellation);
  const flamsteed = s.flamsteedNumber
    ? [
        normalizeText(`${s.flamsteedNumber} ${s.constellation}`),
        normalizeText(
          `${s.flamsteedNumber} ${CONSTELLATIONS[s.constellation]?.[1] ?? s.constellation}`,
        ),
      ]
    : [];
  const parts = [
    s.name,
    s.bayerDesignation ?? "",
    s.flamsteedNumber ? `${s.flamsteedNumber} ${s.constellation}` : "",
    s.spectralType,
    s.constellation,
    s.description,
    ...s.notableFeatures,
  ];
  return {
    id: `star-${s.id}`,
    kind: "star",
    name: s.name,
    brief: s.description,
    magnitude: s.magnitude,
    constellation: s.constellation,
    catalogType: "star",
    searchText: parts.join(" ").toLowerCase(),
    keys: uniq([name, ...bayer, ...flamsteed]),
    // Bayer forms are exact keys, not names: as names, "beta orionis" lifts
    // every lettered star in Orion above M43 for the query "orion".
    names: [name],
    text: normalizeText(
      `${parts.join(" ")} ${bayer.join(" ")} ${constellationWords(s.constellation)}`,
    ),
    notable: !DESIGNATION_NAME.test(s.name),
    flags,
    ra: s.ra,
    dec: s.dec,
  };
}

export function dsoToEntry(d: DSOEntry): SearchEntry {
  const flags = new Set<string>(["dso", d.type]);
  if (d.caldwell) flags.add("caldwell");
  if (/^M\d+$/.test(d.id)) flags.add("messier");
  if (d.aliases?.some((a) => /^M\d+$/.test(a))) flags.add("messier");
  if (d.type === "double-star") flags.add("double");

  // Surface feature keywords found in notableFeatures so chip search hits.
  const featuresBlob = (d.notableFeatures ?? []).join(" ").toLowerCase();
  if (/\bpulsar\b/.test(featuresBlob)) flags.add("pulsar");
  if (/\bquasar\b/.test(featuresBlob)) flags.add("quasar");
  if (/black hole|smbh|supermassive/.test(featuresBlob))
    flags.add("black-hole");
  if (
    /star.forming|stellar nursery|protostar/.test(featuresBlob) ||
    d.type === "hii-region"
  )
    flags.add("star-forming");

  const aliases = d.aliases ?? [];
  const displayName =
    d.commonName || (d.caldwell ? `${d.name} (${d.caldwell})` : d.name);
  const parts = [
    d.name,
    d.commonName,
    d.type,
    d.constellation,
    d.description,
    d.morphology ?? "",
    d.caldwell ?? "",
    d.caldwell ? `caldwell ${d.caldwell}` : "",
    ...aliases,
    ...(d.notableFeatures ?? []),
    ...(d.subObjects ?? []),
  ];
  const names = uniq(
    [displayName, d.commonName, ...aliases].map((n) => (n ? normalizeText(n) : "")),
  );
  return {
    id: `dso-${d.id}`,
    kind: "dso",
    name: displayName,
    brief: d.description,
    magnitude: d.magnitude,
    constellation: d.constellation,
    catalogType: d.type,
    searchText: parts.join(" ").toLowerCase(),
    keys: uniq([
      catalogKey(d.id),
      normalizeText(d.id),
      d.caldwell ? catalogKey(d.caldwell) : null,
      ...aliases.map((a) => catalogKey(a) ?? normalizeText(a)),
      ...names,
    ]),
    names,
    text: normalizeText(
      `${parts.join(" ")} ${d.type.replace(/-/g, " ")} ${constellationWords(d.constellation)}`,
    ),
    notable: Boolean(
      d.commonName || d.caldwell || flags.has("messier") || aliases.length,
    ),
    flags,
    ra: d.ra,
    dec: d.dec,
  };
}

/** A planet's entry; `brief` is the translated one-liner. */
export function planetEntry(name: string, brief: string): SearchEntry {
  const key = normalizeText(name);
  return {
    id: `planet-${name.toLowerCase()}`,
    kind: "planet",
    name,
    brief,
    magnitude: null,
    constellation: "",
    catalogType: "planet",
    searchText: `${name} planet solar system`.toLowerCase(),
    keys: [key],
    names: [key],
    text: `${key} planet solar system`,
    notable: true,
    flags: new Set(["planet"]),
    ra: null,
    dec: null,
  };
}
