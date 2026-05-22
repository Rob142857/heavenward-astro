export type CatalogStatus = "active" | "planned" | "reference";
export type CatalogKind = "runtime" | "supporting" | "expansion";

export interface CatalogUpstream {
  name: string;
  url: string;
  maintainer: string;
  license: string;
  role: string;
}

export interface CatalogImportJob {
  key: string;
  mode: "scripted" | "manual" | "planned";
  sourceUrl: string;
  outputFile: string;
  command: string;
  transform: string[];
  validation: string[];
}

export interface CatalogProvenance {
  key: string;
  label: string;
  icon: string;
  status: CatalogStatus;
  kind: CatalogKind;
  enabledSource: boolean;
  summary: string;
  maintainer: string;
  primaryUrl: string;
  license: string;
  output: string;
  importJob: CatalogImportJob | null;
  upstreams: CatalogUpstream[];
  gratitude: string;
}

export const CATALOG_PROVENANCE: CatalogProvenance[] = [
  {
    key: "planets",
    label: "Planets",
    icon: "planet",
    status: "active",
    kind: "runtime",
    enabledSource: true,
    summary:
      "Mercury through Neptune are computed live in the browser: apparent position, altitude, azimuth, rise/set/transit, elongation, distance, and visual magnitude.",
    maintainer: "Don Cross and astronomy-engine contributors",
    primaryUrl: "https://github.com/cosinekitty/astronomy",
    license: "MIT",
    output: "Client-only ephemeris calculations through src/engine/astro.ts",
    importJob: null,
    upstreams: [
      {
        name: "astronomy-engine",
        url: "https://github.com/cosinekitty/astronomy",
        maintainer: "Don Cross",
        license: "MIT",
        role: "Planetary positions, rise/set searches, magnitudes, and coordinate transforms.",
      },
      {
        name: "JPL Horizons and NOVAS references",
        url: "https://ssd.jpl.nasa.gov/horizons/",
        maintainer: "NASA/JPL Solar System Dynamics and USNO",
        license: "Public scientific reference services",
        role: "External reference material used by astronomy-engine for accuracy checks and validation notes.",
      },
    ],
    gratitude:
      "Thank you to the ephemeris maintainers who turn centuries of observation into reliable positions for tonight.",
  },
  {
    key: "moon",
    label: "Moon",
    icon: "moon",
    status: "active",
    kind: "runtime",
    enabledSource: true,
    summary:
      "Lunar altitude, azimuth, phase, illumination, distance, rise/set/transit, and observing context are computed locally for the viewer's location.",
    maintainer: "Don Cross and astronomy-engine contributors",
    primaryUrl: "https://github.com/cosinekitty/astronomy",
    license: "MIT",
    output: "Client-only lunar calculations through src/engine/astro.ts",
    importJob: null,
    upstreams: [
      {
        name: "astronomy-engine",
        url: "https://github.com/cosinekitty/astronomy",
        maintainer: "Don Cross",
        license: "MIT",
        role: "Lunar position, illumination, phase angle, and rise/set calculations.",
      },
    ],
    gratitude:
      "Thank you to lunar observers, map makers, and ephemeris authors for making our nearest world feel familiar and precise.",
  },
  {
    key: "stars",
    label: "Bright Stars",
    icon: "star",
    status: "active",
    kind: "runtime",
    enabledSource: true,
    summary:
      "Named and navigational stars are imported from HYG v4.2, filtered for bright stars, and enriched with selected human-readable notes for major sky landmarks.",
    maintainer:
      "AstroNexus, ESA Hipparcos/Tycho teams, Yale Bright Star Catalogue maintainers, and catalog compilers",
    primaryUrl: "https://codeberg.org/astronexus/hyg",
    license:
      "CC-BY-SA 4.0 for HYG distribution; upstream catalogs retain their own notices",
    output: "src/catalog/stars.json",
    importJob: {
      key: "stars",
      mode: "scripted",
      sourceUrl:
        "https://codeberg.org/astronexus/hyg/media/branch/main/data/hyg/CURRENT/hyg_v42.csv.gz",
      outputFile: "src/catalog/stars.json",
      command: "npm run refresh -- --stars",
      transform: [
        "Fetch HYG v4.2 gzipped CSV from AstroNexus on Codeberg.",
        "Parse CSV rows and keep stars at magnitude 6.0 or brighter.",
        "Normalize RA hours, Dec degrees, magnitudes, distance in parsecs and light years, spectral type, constellation, and naming fields.",
        "Apply curated enrichment for a small set of prominent stars without changing source coordinates.",
        "Sort by visual magnitude and write typed JSON for dynamic import.",
      ],
      validation: [
        "Reject rows without numeric RA, Dec, or visual magnitude.",
        "Dedupe by proper-name slug or HR identifier.",
        "Round coordinates and numeric fields to stable precision for reproducible diffs.",
      ],
    },
    upstreams: [
      {
        name: "HYG Database v4.2",
        url: "https://codeberg.org/astronexus/hyg",
        maintainer: "AstroNexus",
        license: "CC-BY-SA 4.0 distribution",
        role: "Merged star position, brightness, name, spectral, and distance source used by the importer.",
      },
      {
        name: "Hipparcos and Tycho Catalogues",
        url: "https://www.cosmos.esa.int/web/hipparcos/catalogues",
        maintainer: "European Space Agency and Hipparcos/Tycho science teams",
        license: "ESA catalog attribution required",
        role: "Core astrometric foundation behind many bright-star records.",
      },
      {
        name: "Yale Bright Star Catalogue",
        url: "https://heasarc.gsfc.nasa.gov/W3Browse/star-catalog/bsc5p.html",
        maintainer: "Yale catalog authors and NASA HEASARC hosting team",
        license:
          "Public scientific catalog with citation/attribution expectations",
        role: "Historic bright-star identifiers, magnitudes, and classifications.",
      },
      {
        name: "IAU Working Group on Star Names",
        url: "https://www.iau.org/public/themes/naming_stars/",
        maintainer: "International Astronomical Union",
        license: "IAU public reference material",
        role: "Official proper star names for public-facing labels.",
      },
    ],
    gratitude:
      "Thank you to the astrometrists, survey teams, catalog editors, and backyard observers who kept bright-star knowledge accurate across generations.",
  },
  {
    key: "dso",
    label: "Deep Sky Objects",
    icon: "dso",
    status: "active",
    kind: "runtime",
    enabledSource: true,
    summary:
      "Galaxies, nebulae, and clusters are imported from OpenNGC, filtered for observable magnitudes, normalized into Heavenward's typed DSO shape, and enriched for showpiece objects.",
    maintainer:
      "OpenNGC contributors, NGC/IC researchers, CDS, SIMBAD, NED, and public catalog maintainers",
    primaryUrl: "https://github.com/mattiaverga/OpenNGC",
    license:
      "CC-BY-SA 4.0 for OpenNGC distribution; upstream catalogs retain their own notices",
    output: "src/catalog/dso.json",
    importJob: {
      key: "dso",
      mode: "scripted",
      sourceUrl:
        "https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv",
      outputFile: "src/catalog/dso.json",
      command: "npm run refresh -- --dso",
      transform: [
        "Fetch OpenNGC CSV from GitHub.",
        "Parse semicolon-separated rows and keep objects with usable RA, Dec, type, and magnitude 14.0 or brighter.",
        "Normalize DSO type, RA hours, Dec degrees, angular size, surface brightness, constellation, common name, and Messier/NGC identifiers.",
        "Apply curated notes, imaging guidance, morphology, discoverer, and best-season enrichment for selected showpiece objects.",
        "Sort Messier objects first, then catalog identifiers, and write typed JSON for dynamic import.",
      ],
      validation: [
        "Reject rows without coordinates or visual/blue magnitude.",
        "Dedupe by normalized Messier or catalog identifier.",
        "Round numeric fields to stable precision for reproducible diffs.",
      ],
    },
    upstreams: [
      {
        name: "OpenNGC",
        url: "https://github.com/mattiaverga/OpenNGC",
        maintainer: "OpenNGC contributors",
        license: "CC-BY-SA 4.0",
        role: "Primary machine-readable DSO source for names, types, positions, magnitudes, sizes, and cross-identifications.",
      },
      {
        name: "SIMBAD Astronomical Database",
        url: "https://simbad.cds.unistra.fr/",
        maintainer: "CDS, Strasbourg Astronomical Data Centre",
        license: "CDS citation and acknowledgement requested",
        role: "Object identifiers, classifications, and cross-identifications behind many DSO records.",
      },
      {
        name: "NASA/IPAC Extragalactic Database",
        url: "https://ned.ipac.caltech.edu/",
        maintainer: "NASA/IPAC",
        license: "NED citation and acknowledgement requested",
        role: "Galaxy distance and extragalactic reference data used by source catalogs.",
      },
      {
        name: "CDS VizieR",
        url: "https://vizier.cds.unistra.fr/",
        maintainer: "CDS, Strasbourg Astronomical Data Centre",
        license: "Per-catalog notices plus CDS acknowledgement",
        role: "Host for many nebula, cluster, and survey catalogs used by DSO compilers.",
      },
    ],
    gratitude:
      "Thank you to the observers, plate scanners, survey scientists, and catalog maintainers who turned faint smudges into named places we can visit with a telescope.",
  },
  {
    key: "meteors",
    label: "Meteor Showers",
    icon: "meteor",
    status: "active",
    kind: "runtime",
    enabledSource: true,
    summary:
      "Meteor shower windows, peak dates, radiant positions, ZHR, speed, and parent body details are held in a curated TypeScript catalog for fast offline use.",
    maintainer:
      "International Meteor Organization, IAU Meteor Data Center, and meteor observers worldwide",
    primaryUrl: "https://www.imo.net/resources/meteor-shower-calendar/",
    license:
      "IMO/IAU attribution required; calendar facts compiled with citation",
    output: "src/catalog/meteors.ts",
    importJob: {
      key: "meteors",
      mode: "manual",
      sourceUrl: "https://www.imo.net/resources/meteor-shower-calendar/",
      outputFile: "src/catalog/meteors.ts",
      command:
        "Manual review today; future npm run refresh -- --meteors parser planned",
      transform: [
        "Review IMO annual calendar and IAU Meteor Data Center working-list values.",
        "Normalize activity windows, peak dates, ZHR, velocity, radiant RA/Dec, and parent body names.",
        "Keep a small static catalog so meteor guidance works offline.",
      ],
      validation: [
        "Cross-check activity windows against IMO annual guidance.",
        "Keep coordinates in RA hours and Dec degrees to match engine helpers.",
      ],
    },
    upstreams: [
      {
        name: "International Meteor Organization Meteor Shower Calendar",
        url: "https://www.imo.net/resources/meteor-shower-calendar/",
        maintainer: "International Meteor Organization",
        license: "IMO attribution requested",
        role: "Annual observing calendar, shower activity windows, ZHR expectations, and practical observing context.",
      },
      {
        name: "IAU Meteor Data Center",
        url: "https://www.ta3.sk/IAUC22DB/MDC2007/",
        maintainer: "International Astronomical Union Meteor Data Center",
        license: "Scientific citation and acknowledgement requested",
        role: "Radiant, velocity, and shower designation reference data.",
      },
    ],
    gratitude:
      "Thank you to meteor observers who spend cold nights counting streaks so the rest of us know when to look up.",
  },
  {
    key: "eclipses",
    label: "Eclipses",
    icon: "eclipse",
    status: "active",
    kind: "runtime",
    enabledSource: true,
    summary:
      "Solar and lunar eclipse searches are computed from geometry in astronomy-engine rather than stored as a static server catalog.",
    maintainer: "Don Cross and astronomy-engine contributors",
    primaryUrl: "https://github.com/cosinekitty/astronomy",
    license: "MIT",
    output: "Client-only eclipse search through src/engine/astro.ts",
    importJob: null,
    upstreams: [
      {
        name: "astronomy-engine eclipse search",
        url: "https://github.com/cosinekitty/astronomy",
        maintainer: "Don Cross",
        license: "MIT",
        role: "Besselian-style eclipse geometry and event search.",
      },
      {
        name: "NASA eclipse canons and Espenak/Meeus references",
        url: "https://eclipse.gsfc.nasa.gov/SEpubs/5MCSE.html",
        maintainer: "NASA GSFC eclipse reference authors",
        license: "Public NASA reference material",
        role: "Reference material for long-running eclipse prediction and comparison.",
      },
    ],
    gratitude:
      "Thank you to eclipse chasers, historians, and orbital calculators whose records make these rare alignments predictable.",
  },
  {
    key: "conjunctions",
    label: "Conjunctions",
    icon: "conjunction",
    status: "active",
    kind: "runtime",
    enabledSource: true,
    summary:
      "Close approaches are detected by scanning angular separations between live-computed solar-system positions.",
    maintainer: "Don Cross and astronomy-engine contributors",
    primaryUrl: "https://github.com/cosinekitty/astronomy",
    license: "MIT",
    output: "Client-only conjunction calculations through src/engine/astro.ts",
    importJob: null,
    upstreams: [
      {
        name: "astronomy-engine",
        url: "https://github.com/cosinekitty/astronomy",
        maintainer: "Don Cross",
        license: "MIT",
        role: "Topocentric positions and angular separation calculations.",
      },
    ],
    gratitude:
      "Thank you to the observers who keep making planetary meetings part of public sky culture.",
  },
  {
    key: "images",
    label: "Sky Images and Survey Plates",
    icon: "image",
    status: "active",
    kind: "supporting",
    enabledSource: false,
    summary:
      "Detail pages use NASA SkyView DSS2 survey images and selected Wikimedia Commons astrophotography where attribution is available.",
    maintainer:
      "NASA HEASARC SkyView, Wikimedia Commons contributors, and image authors",
    primaryUrl: "https://skyview.gsfc.nasa.gov/",
    license:
      "NASA public data and per-image Creative Commons/public-domain notices",
    output: "Runtime image URLs and per-image attribution in detail views",
    importJob: null,
    upstreams: [
      {
        name: "NASA SkyView",
        url: "https://skyview.gsfc.nasa.gov/",
        maintainer: "NASA HEASARC",
        license:
          "NASA public scientific data service; acknowledge SkyView/HEASARC",
        role: "DSS2 Red survey plate fallback images for object detail pages.",
      },
      {
        name: "Wikimedia Commons",
        url: "https://commons.wikimedia.org/",
        maintainer: "Wikimedia contributors and image authors",
        license: "Per-image Creative Commons or public-domain notices",
        role: "Selected astrophotography with visible attribution where used.",
      },
    ],
    gratitude:
      "Thank you to observatories, image processors, and generous photographers who let public sky images teach and inspire.",
  },
  {
    key: "webllm",
    label: "Local Sky Guide",
    icon: "ai",
    status: "active",
    kind: "supporting",
    enabledSource: false,
    summary:
      "Optional on-device commentary runs in the browser through WebLLM and WebGPU, with no cloud inference required.",
    maintainer: "MLC AI and WebLLM contributors",
    primaryUrl: "https://github.com/mlc-ai/web-llm",
    license: "Apache-2.0 for WebLLM; model licenses vary by selected model",
    output: "Runtime optional browser model loaded by src/services/llm.ts",
    importJob: null,
    upstreams: [
      {
        name: "WebLLM",
        url: "https://github.com/mlc-ai/web-llm",
        maintainer: "MLC AI contributors",
        license: "Apache-2.0",
        role: "Browser-side local model runtime for optional sky commentary.",
      },
    ],
    gratitude:
      "Thank you to the open model and browser inference teams making local, private guidance possible.",
  },
  {
    key: "gaia-dr3",
    label: "Gaia DR3 Star Expansion",
    icon: "star-field",
    status: "planned",
    kind: "expansion",
    enabledSource: false,
    summary:
      "Planned importer for a deeper star layer using ESA Gaia DR3 subsets, likely prefiltered by magnitude and tiled for browser delivery.",
    maintainer:
      "European Space Agency, Gaia mission, and Gaia Data Processing and Analysis Consortium",
    primaryUrl: "https://www.cosmos.esa.int/web/gaia/dr3",
    license:
      "ESA/Gaia acknowledgement required; verify dataset terms before bundling",
    output: "Planned: src/catalog/gaia-*.json or generated tiled assets",
    importJob: null,
    upstreams: [
      {
        name: "Gaia Data Release 3",
        url: "https://www.cosmos.esa.int/web/gaia/dr3",
        maintainer: "ESA Gaia DPAC",
        license: "ESA/Gaia acknowledgement required",
        role: "High-precision star positions, parallaxes, proper motions, and photometry for deeper future catalogs.",
      },
    ],
    gratitude:
      "Thank you to the Gaia teams for measuring the Milky Way with astonishing patience and precision.",
  },
  {
    key: "simbad-vizier-ned",
    label: "Expanded DSO Cross-Match",
    icon: "catalog",
    status: "planned",
    kind: "expansion",
    enabledSource: false,
    summary:
      "Planned import pipeline for richer names, object types, distances, and cross-identifications from SIMBAD, VizieR-hosted catalogs, and NED.",
    maintainer: "CDS Strasbourg, NASA/IPAC, and individual catalog authors",
    primaryUrl: "https://cds.unistra.fr/",
    license:
      "Per-catalog notices; CDS/NED acknowledgement required; verify before redistribution",
    output: "Planned: enriched DSO sidecar metadata and source manifest",
    importJob: null,
    upstreams: [
      {
        name: "SIMBAD",
        url: "https://simbad.cds.unistra.fr/",
        maintainer: "CDS, Strasbourg Astronomical Data Centre",
        license: "CDS citation and acknowledgement requested",
        role: "Identifiers, object types, bibliography links, and cross-identifications.",
      },
      {
        name: "CDS VizieR",
        url: "https://vizier.cds.unistra.fr/",
        maintainer: "CDS and contributing catalog authors",
        license: "Per-catalog notices",
        role: "Sharpless, Lynds, Barnard, Melotte, Collinder, and many other specialist catalogs.",
      },
      {
        name: "NASA/IPAC Extragalactic Database",
        url: "https://ned.ipac.caltech.edu/",
        maintainer: "NASA/IPAC",
        license: "NED citation and acknowledgement requested",
        role: "Galaxy distances, names, and extragalactic context.",
      },
    ],
    gratitude:
      "Thank you to the database curators who keep astronomical names, measurements, and references connected across the literature.",
  },
  {
    key: "variable-stars",
    label: "Variable Star Expansion",
    icon: "variable",
    status: "planned",
    kind: "expansion",
    enabledSource: false,
    summary:
      "Planned importer for variable-star classifications, periods, and ranges using GCVS and compatible public datasets.",
    maintainer: "GCVS maintainers and variable-star observing community",
    primaryUrl: "http://www.sai.msu.su/gcvs/gcvs/",
    license:
      "Scientific citation and acknowledgement required; verify redistribution terms",
    output: "Planned: variable-star metadata sidecar for star detail pages",
    importJob: null,
    upstreams: [
      {
        name: "General Catalogue of Variable Stars",
        url: "http://www.sai.msu.su/gcvs/gcvs/",
        maintainer: "Sternberg Astronomical Institute and GCVS authors",
        license: "Scientific citation and acknowledgement required",
        role: "Variable-star type, range, period, and designation data.",
      },
    ],
    gratitude:
      "Thank you to variable-star observers whose repeated measurements reveal stars changing over nights, years, and lifetimes.",
  },
];

export function runtimeCatalogSources(): CatalogProvenance[] {
  return CATALOG_PROVENANCE.filter((source) => source.enabledSource);
}

export function acknowledgementSources(): CatalogProvenance[] {
  return CATALOG_PROVENANCE.filter(
    (source) => source.kind === "runtime" || source.kind === "supporting",
  );
}

export function expansionCatalogSources(): CatalogProvenance[] {
  return CATALOG_PROVENANCE.filter((source) => source.kind === "expansion");
}

export function catalogImportJobs(): CatalogImportJob[] {
  return CATALOG_PROVENANCE.flatMap((source) =>
    source.importJob ? [source.importJob] : [],
  );
}

export function getCatalogImportJob(key: string): CatalogImportJob | null {
  return catalogImportJobs().find((job) => job.key === key) ?? null;
}

export function getCatalogProvenance(key: string): CatalogProvenance | null {
  return CATALOG_PROVENANCE.find((source) => source.key === key) ?? null;
}
