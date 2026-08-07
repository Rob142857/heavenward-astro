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
      "Named and navigational stars are imported from HYG v4.2 — which merges Hipparcos and Tycho-2 astrometry with Gaia DR2 parallaxes — filtered to magnitude 6.0 and below, and enriched with curated notes for major landmarks.",
    maintainer:
      "AstroNexus, ESA Hipparcos/Tycho teams, ESA Gaia DPAC, Yale Bright Star Catalogue maintainers, and IAU WGSN",
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
      "Galaxies, nebulae, and clusters are imported from OpenNGC — covering the full NGC and IC catalogues with Messier and Caldwell cross-identifications — filtered to magnitude 14.0 and brighter, normalized into Heavenward's typed shape, and enriched for showpiece objects.",
    maintainer:
      "OpenNGC contributors, Dreyer/Sulentic NGC and IC compilers, Charles Messier, Patrick Moore, CDS, SIMBAD, NED, and public catalog maintainers",
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
    key: "aurora",
    label: "Aurora & Geomagnetic Activity",
    icon: "aurora",
    status: "active",
    kind: "runtime",
    enabledSource: true,
    summary:
      "Live geomagnetic conditions \u2014 current Kp index, 3-day Kp forecast, and the OVATION Prime aurora oval probability for the viewer's latitude \u2014 fetched directly from NOAA Space Weather Prediction Center every 30 minutes. Surfaced on Tonight only when meaningful for your location.",
    maintainer: "NOAA Space Weather Prediction Center",
    primaryUrl: "https://www.swpc.noaa.gov/",
    license: "Public domain (U.S. Government work)",
    output: "Client-side fetch via src/services/aurora.ts; banner on Tonight",
    importJob: null,
    upstreams: [
      {
        name: "NOAA SWPC Planetary K-index",
        url: "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json",
        maintainer: "NOAA Space Weather Prediction Center",
        license: "Public domain",
        role: "Current observed planetary K-index, 3-hour cadence.",
      },
      {
        name: "NOAA SWPC Planetary K-index forecast",
        url: "https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json",
        maintainer: "NOAA Space Weather Prediction Center",
        license: "Public domain",
        role: "3-day Kp forecast in 3-hour bins.",
      },
      {
        name: "NOAA SWPC OVATION Prime aurora oval",
        url: "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json",
        maintainer: "NOAA Space Weather Prediction Center; Newell/Liou OVATION Prime model",
        license: "Public domain",
        role: "1\u00b0 latitude/longitude grid of aurora visibility probability.",
      },
    ],
    gratitude:
      "Thank you to NOAA SWPC and the OVATION Prime authors for keeping our sense of the geomagnetic sky public and free.",
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
    key: "mythology",
    label: "Constellation Mythology",
    icon: "myth",
    status: "active",
    kind: "supporting",
    enabledSource: false,
    summary:
      "Where the AI Sky Guide mentions a constellation's mythology, that content is sourced only from Joseph Campbell's published work, with the specific book cited — never invented, and never astrology.",
    maintainer: "Joseph Campbell (1904–1987)",
    primaryUrl: "https://www.jcf.org/",
    license: "Used with authorization; every entry cites its exact source",
    output: "src/catalog/mythology.json, surfaced via src/engine/nearby.ts",
    importJob: null,
    upstreams: [
      {
        name: "The Hero with a Thousand Faces (1949)",
        url: "https://www.jcf.org/",
        maintainer: "Joseph Campbell",
        license: "Used with authorization, cited per entry",
        role: "Source for Aries, Auriga, Perseus, and Argo Navis (Carina/Puppis/Vela) entries.",
      },
      {
        name: "The Masks of God, Vol. 4: Creative Mythology (1968)",
        url: "https://www.jcf.org/",
        maintainer: "Joseph Campbell",
        license: "Used with authorization, cited per entry",
        role: "Source for Orion and Gemini entries.",
      },
      {
        name: "Historical Atlas of World Mythology, Vol. I: The Way of the Animal Powers (1983)",
        url: "https://www.jcf.org/",
        maintainer: "Joseph Campbell",
        license: "Used with authorization, cited per entry",
        role: "Source for Ursa Major and Ursa Minor entries.",
      },
      {
        name: "The Power of Myth (1988)",
        url: "https://www.jcf.org/",
        maintainer: "Joseph Campbell and Bill Moyers",
        license: "Used with authorization, cited per entry",
        role: "Source for the Cygnus entry.",
      },
    ],
    gratitude:
      "Coverage is intentionally partial — Campbell was a comparative mythologist, not a systematic star-catalog author, and the one volume that might have covered every constellation was left unfinished at his death. Thank you for treating an honest gap as more trustworthy than an invented one.",
  },
  {
    key: "history",
    label: "Historical Astronomy",
    icon: "scroll",
    status: "active",
    kind: "supporting",
    enabledSource: false,
    summary:
      "Documented facts about how ancient cultures observed and used the sky — sourced only from actual primary texts or established academic scholarship, never speculation.",
    maintainer: "Various ancient authors and modern scholars, per entry",
    primaryUrl: "https://en.wikipedia.org/wiki/MUL.APIN",
    license: "Public-domain ancient texts and cited academic scholarship",
    output: "src/catalog/history.json, surfaced via src/engine/nearby.ts",
    importJob: null,
    upstreams: [
      {
        name: "MUL.APIN (c. 1000 BCE Babylonian star compendium)",
        url: "https://en.wikipedia.org/wiki/MUL.APIN",
        maintainer: "Critical translation: Hunger & Pingree (1989)",
        license: "Ancient public-domain text; translation cited per entry",
        role: "Source for the Orion, Taurus, Scorpius, and Virgo entries.",
      },
      {
        name: "Hesiod, Works and Days (c. 700 BCE)",
        url: "https://www.perseus.tufts.edu/",
        maintainer: "Trans. Hugh G. Evelyn-White, Loeb Classical Library",
        license: "Ancient public-domain text",
        role: "Source for the Pleiades/Taurus farming-calendar entry.",
      },
      {
        name: "Pyramid Texts; Censorinus, De Die Natali (238 CE)",
        url: "https://en.wikipedia.org/wiki/Sothic_cycle",
        maintainer: "Trans. R.O. Faulkner; various Egyptological scholarship",
        license: "Ancient public-domain texts; scholarship cited per entry",
        role: "Source for the Sirius/Nile-flood and Orion/Osiris entries.",
      },
      {
        name: "Huainanzi (139 BCE); Sima Qian, Shiji (c. 91 BCE)",
        url: "https://en.wikipedia.org/wiki/Huainanzi",
        maintainer: "Trans. in Pankenier, Astrology and Cosmology in Early China (2013)",
        license: "Ancient public-domain texts",
        role: "Source for the Ursa Major/Beidou entry.",
      },
    ],
    gratitude:
      "Thank you to the translators and scholars who keep these primary texts legible across three thousand years, so a modern stargazer can read almost the same words an ancient one did.",
  },
  {
    key: "namesakes",
    label: "Star Namesakes",
    icon: "myth",
    status: "active",
    kind: "supporting",
    enabledSource: false,
    summary:
      "Ships, rockets, telescopes, an aeroplane and a public holiday that took a star's name. Every entry rests on a record from the people who did the naming — a naval reference work, an agency release, a company's own history — never on the fact that two names happen to match. Where a naming story is only ever repeated second-hand, it is marked as such.",
    maintainer: "Compiled from primary organisational records",
    primaryUrl: "https://www.history.navy.mil/research/histories/ship-histories/danfs.html",
    license: "Public records and organisational statements, cited per entry",
    output: "src/catalog/namesakes.json, surfaced via src/engine/nearby.ts",
    importJob: null,
    upstreams: [
      {
        name: "Dictionary of American Naval Fighting Ships",
        url: "https://www.history.navy.mil/research/histories/ship-histories/danfs.html",
        maintainer: "Naval History and Heritage Command",
        license: "US Government work, public domain",
        role: "Source for the Rigel, Bellatrix, Denebola and Albireo ships — each entry opens with the star, in the Navy's own words.",
      },
      {
        name: "NASA and ESA naming announcements",
        url: "https://www.nasa.gov/",
        maintainer: "NASA; European Space Agency",
        license: "Agency releases, cited per entry",
        role: "Source for Orion, Altair, the Scout rocket stages, the Canopus star tracker and Europe's Vega launcher.",
      },
      {
        name: "Company and institutional histories",
        url: "https://www.subaru.co.jp/en/",
        maintainer: "Subaru Corporation; NAOJ; Lockheed Martin; Capella Space; Aldebaran; Sirius",
        license: "Organisations' own published statements, cited per entry",
        role: "Source for the Subaru Telescope and carmaker, the Lockheed Electra, Capella Space, Aldebaran Robotics and Sirius Satellite Radio.",
      },
      {
        name: "Te Kāhui o Matariki Public Holiday Act 2022",
        url: "https://www.legislation.govt.nz/",
        maintainer: "New Zealand Parliament",
        license: "Crown copyright, freely reproducible",
        role: "Source for Matariki — the first public holiday anywhere set by an indigenous astronomical calendar.",
      },
    ],
    gratitude:
      "Thank you to the archivists and record-keepers who wrote down why a name was chosen. It is the easiest detail in the world to lose, and without them every one of these stories would be folklore.",
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
    label: "Variable Stars",
    icon: "variable",
    status: "active",
    kind: "supporting",
    enabledSource: false,
    summary:
      "Variability classifications and period notes shown on star detail pages draw on the General Catalogue of Variable Stars and the AAVSO Variable Star Index — the same references Stellarium relies on.",
    maintainer:
      "Sternberg Astronomical Institute (GCVS), AAVSO, and the worldwide variable-star observing community",
    primaryUrl: "http://www.sai.msu.su/gcvs/gcvs/",
    license:
      "Scientific citation and acknowledgement required for GCVS and VSX",
    output: "Surfaced on star detail pages via the `isVariable` / `variableType` / `variablePeriod` fields",
    importJob: null,
    upstreams: [
      {
        name: "General Catalogue of Variable Stars (GCVS)",
        url: "http://www.sai.msu.su/gcvs/gcvs/",
        maintainer: "Sternberg Astronomical Institute and GCVS authors",
        license: "Scientific citation and acknowledgement required",
        role: "Type, range, period, and designation reference for variable stars.",
      },
      {
        name: "AAVSO Variable Star Index (VSX)",
        url: "https://www.aavso.org/vsx/",
        maintainer: "American Association of Variable Star Observers",
        license: "AAVSO acknowledgement requested",
        role: "Curated, continuously-updated variable-star designations and classifications.",
      },
    ],
    gratitude:
      "Thank you to the variable-star observers whose patient nightly counts reveal stars changing over hours, years, and lifetimes.",
  },
  {
    key: "iau-star-names",
    label: "IAU Star Names",
    icon: "star",
    status: "active",
    kind: "supporting",
    enabledSource: false,
    summary:
      "Proper star names on labels and detail pages follow the IAU Working Group on Star Names — the authoritative public list of approved star names that Stellarium and most modern atlases share.",
    maintainer: "International Astronomical Union — Working Group on Star Names",
    primaryUrl: "https://www.iau.org/public/themes/naming_stars/",
    license: "IAU public reference material",
    output: "Applied during the bright-star refresh so star records carry approved proper names",
    importJob: null,
    upstreams: [
      {
        name: "IAU Catalog of Star Names (IAU-CSN)",
        url: "https://www.iau.org/public/themes/naming_stars/",
        maintainer: "IAU WGSN",
        license: "IAU public reference material",
        role: "Authoritative list of approved proper names with originating culture and citation.",
      },
    ],
    gratitude:
      "Thank you to the IAU naming committee for keeping a shared, public vocabulary of star names across languages and centuries.",
  },
  {
    key: "double-stars",
    label: "Double & Multiple Stars",
    icon: "star",
    status: "active",
    kind: "supporting",
    enabledSource: false,
    summary:
      "Double-star and visual-binary flags on star detail pages follow the Washington Double Star Catalog maintained at the US Naval Observatory — the same reference Stellarium uses for its WDS layer.",
    maintainer: "US Naval Observatory and the WDS observing community",
    primaryUrl: "http://www.astro.gsu.edu/wds/",
    license: "Public scientific catalog; USNO acknowledgement requested",
    output: "Surfaced on star detail pages via the `isDouble` / `doubleCompanion` fields",
    importJob: null,
    upstreams: [
      {
        name: "Washington Double Star Catalog (WDS)",
        url: "http://www.astro.gsu.edu/wds/",
        maintainer: "US Naval Observatory, Brian D. Mason et al.",
        license: "Public scientific catalog with citation requested",
        role: "Pair separations, position angles, magnitudes, and identifiers for visual binaries and multiples.",
      },
    ],
    gratitude:
      "Thank you to the double-star observers and the USNO compilers who turned centuries of split-eyepiece measurements into a single living catalog.",
  },
  {
    key: "exoplanets",
    label: "Exoplanet Host Stars",
    icon: "star",
    status: "active",
    kind: "supporting",
    enabledSource: false,
    summary:
      "Exoplanet host-star markers and counts come from the NASA Exoplanet Archive — the same source Stellarium's exoplanet plugin draws on — keeping discoveries current as new worlds are confirmed.",
    maintainer: "NASA Exoplanet Science Institute at IPAC",
    primaryUrl: "https://exoplanetarchive.ipac.caltech.edu/",
    license: "NASA public scientific data; citation requested",
    output: "Surfaced on star detail pages via the `hasExoplanets` / `exoplanetCount` fields",
    importJob: null,
    upstreams: [
      {
        name: "NASA Exoplanet Archive",
        url: "https://exoplanetarchive.ipac.caltech.edu/",
        maintainer: "NASA Exoplanet Science Institute / IPAC / Caltech",
        license: "NASA public data; standard citation requested",
        role: "Authoritative catalog of confirmed exoplanets, host-star cross-identifications, and discovery context.",
      },
    ],
    gratitude:
      "Thank you to the planet-hunting teams and archive curators turning the night sky into a list of other worlds.",
  },
  {
    key: "constellations",
    label: "Constellations & Sky Boundaries",
    icon: "catalog",
    status: "active",
    kind: "supporting",
    enabledSource: false,
    summary:
      "Each star carries its IAU constellation as defined by the 1928 Delporte boundaries — the same official partition of the sky that Stellarium uses for its modern Western sky culture.",
    maintainer: "International Astronomical Union and Eugène Delporte (historical)",
    primaryUrl: "https://www.iau.org/public/themes/constellations/",
    license: "Public scientific reference; IAU attribution",
    output: "Constellation field applied per star and per DSO record during refresh",
    importJob: null,
    upstreams: [
      {
        name: "IAU constellations and 1928 boundaries",
        url: "https://www.iau.org/public/themes/constellations/",
        maintainer: "International Astronomical Union",
        license: "Public scientific reference",
        role: "Authoritative list of the 88 constellations and their sky boundaries.",
      },
      {
        name: "HYG constellation lines",
        url: "https://codeberg.org/astronexus/hyg",
        maintainer: "AstroNexus / HYG project",
        license: "CC-BY-SA 4.0",
        role: "Convenient redistribution of constellation line vertices for the modern Western set.",
      },
    ],
    gratitude:
      "Thank you to the cultures, mythographers, and 20th-century cartographers who agreed on a shared map of the sky we can all point at.",
  },
  {
    key: "mpc-comets",
    label: "Comets & Bright Asteroids",
    icon: "meteor",
    status: "planned",
    kind: "expansion",
    enabledSource: false,
    summary:
      "Planned importer for Minor Planet Center orbital elements covering currently observable comets and bright asteroids — the same upstream Stellarium's solar-system editor draws on.",
    maintainer:
      "IAU Minor Planet Center at the Center for Astrophysics, Harvard & Smithsonian",
    primaryUrl: "https://www.minorplanetcenter.net/",
    license: "MPC public scientific data; citation requested",
    output: "Planned: src/catalog/mpc-*.json with refresh-driven orbital elements",
    importJob: null,
    upstreams: [
      {
        name: "MPC Comet and Asteroid orbits",
        url: "https://www.minorplanetcenter.net/data",
        maintainer: "IAU Minor Planet Center",
        license: "MPC public scientific data",
        role: "Authoritative orbital elements for active comets and numbered minor planets.",
      },
    ],
    gratitude:
      "Thank you to the MPC and to amateur and professional minor-body observers worldwide for keeping the small-bodies catalog alive.",
  },
  {
    key: "celestrak-satellites",
    label: "Satellites & ISS Passes",
    icon: "catalog",
    status: "planned",
    kind: "expansion",
    enabledSource: false,
    summary:
      "Planned importer for NORAD two-line element sets via CelesTrak so the ISS and notable satellites can be predicted client-side — Stellarium's satellite plugin uses the same source.",
    maintainer: "CelesTrak (Dr. T.S. Kelso) with US Space Force public TLE feeds",
    primaryUrl: "https://celestrak.org/",
    license: "Publicly redistributable TLEs; CelesTrak attribution requested",
    output: "Planned: live-refreshed TLEs propagated client-side via an SGP4 implementation",
    importJob: null,
    upstreams: [
      {
        name: "CelesTrak NORAD element sets",
        url: "https://celestrak.org/NORAD/elements/",
        maintainer: "Dr. T.S. Kelso / CelesTrak",
        license: "Public TLE redistribution with attribution",
        role: "Two-line element sets for ISS, Starlink, scientific satellites, and visual brights.",
      },
    ],
    gratitude:
      "Thank you to the satellite-tracking community for keeping a clean, public record of what's overhead at any minute.",
  },
  {
    key: "bright-nebulae",
    label: "Sharpless, LBN & LDN Nebulae",
    icon: "dso",
    status: "planned",
    kind: "expansion",
    enabledSource: false,
    summary:
      "Planned importer for the Sharpless HII catalog plus Lynds bright and dark nebula lists — the deeper nebular layer Stellarium exposes through its extended DSO bundles, accessible directly via CDS VizieR.",
    maintainer: "Stewart Sharpless, Beverly Lynds, and CDS VizieR mirror maintainers",
    primaryUrl: "https://vizier.cds.unistra.fr/viz-bin/VizieR?-source=VII/20",
    license: "Per-catalog notices via VizieR; CDS acknowledgement requested",
    output: "Planned: dso.json supplements with `sh2-` / `lbn-` / `ldn-` identifiers",
    importJob: null,
    upstreams: [
      {
        name: "Sharpless catalog (Sh2)",
        url: "https://vizier.cds.unistra.fr/viz-bin/VizieR?-source=VII/20",
        maintainer: "Stewart Sharpless / CDS VizieR",
        license: "Public scientific catalog via CDS",
        role: "HII region catalog covering visible emission nebulae.",
      },
      {
        name: "Lynds Bright (LBN) and Dark (LDN) nebulae",
        url: "https://vizier.cds.unistra.fr/viz-bin/VizieR?-source=VII/9",
        maintainer: "Beverly Lynds / CDS VizieR",
        license: "Public scientific catalog via CDS",
        role: "Bright and dark molecular cloud catalogs.",
      },
    ],
    gratitude:
      "Thank you to the plate scanners and survey astronomers who let us name the diffuse glow between the stars.",
  },
  {
    key: "atnf-pulsars",
    label: "Pulsars",
    icon: "variable",
    status: "planned",
    kind: "expansion",
    enabledSource: false,
    summary:
      "Planned importer for the ATNF Pulsar Catalogue — Stellarium's pulsar plugin upstream — for a faint but fascinating layer of rotation-period and dispersion-measure markers.",
    maintainer: "Australia Telescope National Facility, CSIRO",
    primaryUrl: "https://www.atnf.csiro.au/research/pulsar/psrcat/",
    license: "Scientific citation and acknowledgement required",
    output: "Planned: src/catalog/pulsars.json for detail-page enrichment",
    importJob: null,
    upstreams: [
      {
        name: "ATNF Pulsar Catalogue (PSRCAT)",
        url: "https://www.atnf.csiro.au/research/pulsar/psrcat/",
        maintainer: "R.N. Manchester et al., CSIRO ATNF",
        license: "Citation required",
        role: "Pulsar positions, periods, dispersion measures, and observational notes.",
      },
    ],
    gratitude:
      "Thank you to the radio astronomers timing neutron stars night after night and sharing the results.",
  },
  {
    key: "usgs-nomenclature",
    label: "Planetary Surface Names",
    icon: "planet",
    status: "planned",
    kind: "expansion",
    enabledSource: false,
    summary:
      "Planned importer for the USGS Gazetteer of Planetary Nomenclature — Stellarium's surface-feature layer upstream — so lunar and planetary detail pages can name craters, maria, and montes.",
    maintainer: "US Geological Survey Astrogeology Science Center and the IAU WGPSN",
    primaryUrl: "https://planetarynames.wr.usgs.gov/",
    license: "USGS public data; IAU WGPSN attribution requested",
    output: "Planned: per-body nomenclature sidecars for Moon, Mars, and large moons",
    importJob: null,
    upstreams: [
      {
        name: "USGS Gazetteer of Planetary Nomenclature",
        url: "https://planetarynames.wr.usgs.gov/",
        maintainer: "USGS Astrogeology / IAU WGPSN",
        license: "Public USGS data",
        role: "Authoritative names, coordinates, and feature classifications across the Solar System.",
      },
    ],
    gratitude:
      "Thank you to the planetary cartographers who give every crater, ridge, and sea a name we can speak.",
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
