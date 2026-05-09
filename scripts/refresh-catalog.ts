/**
 * Heavenward Catalog Refresh Script
 *
 * Pulls from authoritative astronomical databases and compiles
 * enriched JSON catalogs for the PWA.
 *
 * Sources:
 *   DSOs  → OpenNGC (GitHub CSV) — CC-BY-SA 4.0
 *   Stars → HYG Database v4.2 (Codeberg, gzipped CSV) — CC-BY-SA 4.0
 *
 * Usage:
 *   node --experimental-strip-types scripts/refresh-catalog.ts
 *   node --experimental-strip-types scripts/refresh-catalog.ts --dso
 *   node --experimental-strip-types scripts/refresh-catalog.ts --stars
 *   node --experimental-strip-types scripts/refresh-catalog.ts --all
 *
 * Outputs:
 *   src/catalog/dso.json
 *   src/catalog/stars.json
 */

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CATALOG_DIR = resolve(__dirname, '..', 'src', 'catalog');

// ── CSV Parser (lightweight, no deps) ──────────────────────────────

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  if (lines.length < 2) return [];
  const headers = lines[0].split(';').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const vals = line.split(';');
    const obj: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i]] = (vals[i] ?? '').trim();
    }
    return obj;
  });
}

function parseCommaSV(text: string): Record<string, string>[] {
  const lines = text.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map((line) => {
    // Handle quoted fields
    const vals: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') { inQuotes = !inQuotes; continue; }
      if (char === ',' && !inQuotes) { vals.push(current.trim()); current = ''; continue; }
      current += char;
    }
    vals.push(current.trim());
    const obj: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i]] = vals[i] ?? '';
    }
    return obj;
  });
}

// ── DSO enrichment data ────────────────────────────────────────────

interface DSOEnrichment {
  description: string;
  physicalSize: string | null;
  notableFeatures: string[];
  subObjects: string[];
  discoverer: string | null;
  yearDiscovered: number | null;
  morphology: string | null;
  bestSeason: string | null;
  imagingNotes: string | null;
}

// Hand-curated enrichment for the most important objects
// (OpenNGC provides positions/magnitudes but not narrative data)
const DSO_ENRICHMENTS: Record<string, DSOEnrichment> = {
  'M1': {
    description: 'Remnant of the supernova observed by Chinese astronomers in 1054 AD. Contains a pulsar spinning 30 times per second that powers the nebula\'s eerie glow.',
    physicalSize: '11 ly × 7 ly',
    notableFeatures: ['Crab Pulsar (PSR B0531+21)', 'Synchrotron radiation', 'Expanding at 1,500 km/s', 'X-ray source'],
    subObjects: ['Crab Pulsar'],
    discoverer: 'John Bevis', yearDiscovered: 1731,
    morphology: 'Filamentary supernova remnant',
    bestSeason: 'Winter', imagingNotes: 'Use O-III or SII-Ha-OIII palette. 30s+ exposures reveal filamentary structure.'
  },
  'M8': {
    description: 'One of the finest emission nebulae, visible to the naked eye. Contains the young open cluster NGC 6530 and the Hourglass Nebula near its center.',
    physicalSize: '140 ly × 60 ly',
    notableFeatures: ['Hourglass Nebula', 'NGC 6530 (embedded cluster)', 'Bok globules', 'Active star-forming region'],
    subObjects: ['NGC 6530', 'Hourglass Nebula'],
    discoverer: 'Giovanni Hodierna', yearDiscovered: 1654,
    morphology: 'Emission nebula with dark lanes',
    bestSeason: 'Summer', imagingNotes: 'Narrowband Ha reveals extensive structure. Best from southern latitudes.'
  },
  'M13': {
    description: 'The finest globular cluster in the northern sky. Contains ~300,000 stars in a sphere 145 ly across. The 1974 Arecibo message was beamed at this cluster.',
    physicalSize: '145 ly diameter',
    notableFeatures: ['Propeller asterism', '~300,000 stars', 'Arecibo message target (1974)', 'Age ~11.65 billion years'],
    subObjects: [],
    discoverer: 'Edmond Halley', yearDiscovered: 1714,
    morphology: 'Globular cluster, class V',
    bestSeason: 'Summer', imagingNotes: 'Resolves into individual stars with 30s on smart telescopes. Best at f/5-f/8.'
  },
  'M16': {
    description: 'Home to the famous Pillars of Creation photographed by Hubble. An active star-forming region with the young open cluster embedded within.',
    physicalSize: '70 ly × 55 ly',
    notableFeatures: ['Pillars of Creation', 'Stellar Spire', 'NGC 6611 (embedded cluster)', 'EGGs (evaporating gaseous globules)'],
    subObjects: ['NGC 6611', 'Pillars of Creation'],
    discoverer: 'Jean-Philippe de Chéseaux', yearDiscovered: 1745,
    morphology: 'Emission nebula + open cluster',
    bestSeason: 'Summer', imagingNotes: 'Ha narrowband essential. SHO palette reveals pillar detail beautifully.'
  },
  'M17': {
    description: 'One of the brightest emission nebulae. The swan-shaped bar is the brightest part of a much larger HII region spanning 40 ly.',
    physicalSize: '40 ly across',
    notableFeatures: ['Swan/Omega shape', '800+ stars in embedded cluster', 'Open cluster NGC 6618', 'One of the most massive HII regions'],
    subObjects: ['NGC 6618'],
    discoverer: 'Jean-Philippe de Chéseaux', yearDiscovered: 1745,
    morphology: 'Emission nebula',
    bestSeason: 'Summer', imagingNotes: 'Very bright — short exposures reveal swan shape. Ha shows extended structure.'
  },
  'M20': {
    description: 'Unique combination of emission (red), reflection (blue), and dark nebulae all in one object. Trisected by dark dust lanes.',
    physicalSize: '42 ly diameter',
    notableFeatures: ['Three types of nebulae combined', 'Dark trifurcating lanes', 'HII region', 'Very young star cluster (~300,000 years)'],
    subObjects: [],
    discoverer: 'Charles Messier', yearDiscovered: 1764,
    morphology: 'Emission + reflection + dark nebula',
    bestSeason: 'Summer', imagingNotes: 'RGB captures the red/blue contrast. Narrowband loses the reflection component.'
  },
  'M27': {
    description: 'The first planetary nebula discovered. A dying star has ejected its outer layers forming a dumbbell shape 1,360 ly away.',
    physicalSize: '2.5 ly × 1.5 ly',
    notableFeatures: ['14th magnitude central white dwarf', 'Expanding at 31 km/s', 'Age ~10,000 years', 'Central star temp ~85,000 K'],
    subObjects: [],
    discoverer: 'Charles Messier', yearDiscovered: 1764,
    morphology: 'Bipolar planetary nebula',
    bestSeason: 'Summer', imagingNotes: 'O-III filter brings out the outer shell. 30s captures core structure easily.'
  },
  'M31': {
    description: 'Our nearest large galactic neighbour at 2.5 million ly. Contains ~1 trillion stars and is approaching the Milky Way at 110 km/s for a collision in ~4.5 billion years.',
    physicalSize: '220,000 ly diameter',
    notableFeatures: ['~1 trillion stars', 'Approaching at 110 km/s', 'Collision with Milky Way in ~4.5 Gyr', '~450 globular clusters', 'Double nucleus'],
    subObjects: ['M32 (satellite galaxy)', 'M110 (satellite galaxy)', 'NGC 206 (star cloud)', 'G1 (Mayall II, brightest globular)'],
    discoverer: 'Abd al-Rahman al-Sufi', yearDiscovered: 964,
    morphology: 'SA(s)b — barred spiral galaxy',
    bestSeason: 'Autumn', imagingNotes: 'Wide-field captures dust lanes. 30s shows core + spiral arms. Mosaic for full extent.'
  },
  'M32': {
    description: 'Compact elliptical satellite galaxy of M31. One of the nearest elliptical galaxies, showing evidence of a supermassive black hole.',
    physicalSize: '6,500 ly diameter',
    notableFeatures: ['Satellite of M31', 'Supermassive black hole (~3M solar masses)', 'Compact elliptical', 'Tidally stripped by M31'],
    subObjects: [],
    discoverer: 'Guillaume Le Gentil', yearDiscovered: 1749,
    morphology: 'cE2 — compact elliptical',
    bestSeason: 'Autumn', imagingNotes: 'Best captured alongside M31. Small but bright.'
  },
  'M33': {
    description: 'The Triangulum Galaxy is the third-largest member of the Local Group. It contains the enormous NGC 604 HII region, one of the largest known.',
    physicalSize: '60,000 ly diameter',
    notableFeatures: ['NGC 604 (giant HII region)', 'Face-on spiral', 'No bulge', '~40 billion stars', 'Local Group member'],
    subObjects: ['NGC 604', 'NGC 595', 'IC 131'],
    discoverer: 'Giovanni Battista Hodierna', yearDiscovered: 1654,
    morphology: 'SA(s)cd — unbarred spiral',
    bestSeason: 'Autumn', imagingNotes: 'Very low surface brightness — needs dark skies. Ha reveals NGC 604 dramatically.'
  },
  'M42': {
    description: 'The brightest diffuse nebula in the sky and the nearest massive star-forming region. Contains the Trapezium cluster whose UV radiation illuminates the entire nebula.',
    physicalSize: '24 ly across',
    notableFeatures: ['Trapezium Cluster (θ¹ Orionis)', 'Proplyds (protoplanetary disks)', 'Herbig-Haro objects', 'Over 700 stars in various stages of formation'],
    subObjects: ['M43 (De Mairan\'s Nebula)', 'Trapezium (θ¹ Ori)', 'NGC 1977 (Running Man)', 'Kleinmann-Low Nebula'],
    discoverer: 'Nicolas-Claude Fabri de Peiresc', yearDiscovered: 1610,
    morphology: 'Giant molecular cloud / HII region',
    bestSeason: 'Winter', imagingNotes: 'Extremely bright — HDR or short exposures for core, long for wings. 30s shows incredible detail.'
  },
  'M44': {
    description: 'The Beehive Cluster is one of the nearest open clusters. Known since antiquity, it was used by ancient sailors to predict weather.',
    physicalSize: '23 ly diameter',
    notableFeatures: ['~1,000 stars', 'Age ~600 million years', 'Contains 5 confirmed exoplanet host stars', 'Praesepe — "The Manger"'],
    subObjects: [],
    discoverer: 'Known since antiquity', yearDiscovered: -200,
    morphology: 'Open cluster, Trumpler class II 2 m',
    bestSeason: 'Spring', imagingNotes: 'Wide FOV needed (1.5°). Best with short focal lengths.'
  },
  'M45': {
    description: 'The most famous star cluster, known across every ancient culture. The blue reflection nebulae around the stars are unrelated dust the cluster is passing through.',
    physicalSize: '17.5 ly diameter',
    notableFeatures: ['Blue reflection nebulae (Merope Nebula)', 'Age ~100 million years', 'Moving through interstellar dust', 'Seven Sisters — Sterope, Merope, Electra, Maia, Taygeta, Celaeno, Alcyone'],
    subObjects: ['Merope Nebula (NGC 1435)', 'Maia Nebula (NGC 1432)'],
    discoverer: 'Known since antiquity', yearDiscovered: -2000,
    morphology: 'Open cluster with reflection nebulosity',
    bestSeason: 'Winter', imagingNotes: 'RGB captures the blue nebulosity. Smart telescopes reveal nebulae in 30-60s.'
  },
  'M51': {
    description: 'The first spiral galaxy ever identified. Its companion NGC 5195 is undergoing a close encounter, triggering intense star formation in the spiral arms.',
    physicalSize: '76,000 ly diameter',
    notableFeatures: ['First identified spiral galaxy (1845)', 'Interacting with NGC 5195', 'Seyfert 2 nucleus', 'Three supernovae observed (1994, 2005, 2011)'],
    subObjects: ['NGC 5195 (companion galaxy)'],
    discoverer: 'Charles Messier', yearDiscovered: 1773,
    morphology: 'SA(s)bc pec — grand-design spiral',
    bestSeason: 'Spring', imagingNotes: 'Beautiful face-on spiral. 30-60s resolves spiral arms. HII regions visible in Ha.'
  },
  'M57': {
    description: 'The Ring Nebula is the most observed planetary nebula. The central star, a white dwarf at 120,000 K, is ionizing the ejected shell.',
    physicalSize: '1.3 ly × 1.0 ly',
    notableFeatures: ['15th magnitude central white dwarf', 'Ring is actually a cylinder seen end-on', 'Age ~6,000-8,000 years', 'Expanding at 20-30 km/s'],
    subObjects: ['IC 1296 (background galaxy near Ring)'],
    discoverer: 'Antoine Darquier de Pellepoix', yearDiscovered: 1779,
    morphology: 'Bipolar planetary nebula',
    bestSeason: 'Summer', imagingNotes: 'Bright and compact. O-III filter reveals outer halo. Easy 30s target.'
  },
  'M63': {
    description: 'The Sunflower Galaxy has a bright core and tightly wound spiral arms with a distinctive flocculent pattern giving it a sunflower appearance.',
    physicalSize: '98,000 ly diameter',
    notableFeatures: ['Flocculent spiral arms', 'Extended tidal stream', 'LINER nucleus', 'Part of M51 group'],
    subObjects: [],
    discoverer: 'Pierre Méchain', yearDiscovered: 1779,
    morphology: 'SA(rs)bc — flocculent spiral',
    bestSeason: 'Spring', imagingNotes: 'Deep imaging reveals the tidal stream. 60-120s for spiral structure.'
  },
  'M81': {
    description: 'One of the brightest galaxies beyond the Local Group. Grand-design spiral arms are beautifully defined. Gravitationally interacting with M82.',
    physicalSize: '90,000 ly diameter',
    notableFeatures: ['Grand-design spiral', 'Gravitational interaction with M82', 'Supermassive BH (70M solar)', 'SN 1993J observed'],
    subObjects: ['M82 (nearby starburst galaxy)'],
    discoverer: 'Johann Elert Bode', yearDiscovered: 1774,
    morphology: 'SA(s)ab — grand-design spiral',
    bestSeason: 'Spring', imagingNotes: 'Frame M81+M82 together. Ha reveals HII regions in arms. Beautiful in RGB.'
  },
  'M82': {
    description: 'The prototype starburst galaxy. Gravitational interaction with M81 triggered extreme star formation. Superwind of gas streams perpendicular to the disk.',
    physicalSize: '37,000 ly diameter',
    notableFeatures: ['Starburst galaxy prototype', 'Bipolar superwind outflow', 'Star formation rate 10× Milky Way', 'Strong infrared source'],
    subObjects: [],
    discoverer: 'Johann Elert Bode', yearDiscovered: 1774,
    morphology: 'I0 — irregular starburst',
    bestSeason: 'Spring', imagingNotes: 'Ha filter reveals the spectacular red superwind filaments. Pair with M81.'
  },
  'M101': {
    description: 'A massive face-on spiral galaxy nearly twice the diameter of the Milky Way. Contains over a trillion stars and enormous HII regions.',
    physicalSize: '170,000 ly diameter',
    notableFeatures: ['Asymmetric spiral arms', 'NGC 5471 (giant HII region)', 'Over 1 trillion stars', 'SN 2023ixf observed'],
    subObjects: ['NGC 5461', 'NGC 5462', 'NGC 5471'],
    discoverer: 'Pierre Méchain', yearDiscovered: 1781,
    morphology: 'SAB(rs)cd — face-on spiral',
    bestSeason: 'Spring', imagingNotes: 'Low surface brightness — dark skies help. Ha reveals HII regions beautifully.'
  },
  'M104': {
    description: 'The Sombrero Galaxy has a brilliant white core, a large central bulge, and a dramatic dark dust lane. Contains a supermassive black hole of 1 billion solar masses.',
    physicalSize: '49,000 ly diameter',
    notableFeatures: ['Prominent dust lane', '1 billion solar mass black hole', '~2,000 globular clusters', 'Bright bulge'],
    subObjects: [],
    discoverer: 'Pierre Méchain', yearDiscovered: 1781,
    morphology: 'SA(s)a — edge-on spiral/elliptical',
    bestSeason: 'Spring', imagingNotes: 'Dramatic in any telescope. 30s shows dust lane clearly. Southern declination.'
  },
  'NGC7000': {
    description: 'The North America Nebula spans 3° — six full Moon widths. Part of the same star-forming complex as the Pelican Nebula (IC 5070), separated by a dark dust lane.',
    physicalSize: '100 ly across',
    notableFeatures: ['3° apparent size', 'Part of complex with IC 5070', 'Gulf of Mexico (dark lane)', 'Ionized by unseen O-type star'],
    subObjects: ['IC 5070 (Pelican Nebula)', 'Cygnus Wall'],
    discoverer: 'William Herschel', yearDiscovered: 1786,
    morphology: 'Emission nebula / HII region',
    bestSeason: 'Summer', imagingNotes: 'Ha narrowband essential. Wide FOV needed. The Cygnus Wall is the most photogenic section.'
  },
  'NGC6992': {
    description: 'The Eastern Veil — part of the Cygnus Loop supernova remnant from a star that exploded 10,000-20,000 years ago. Filaments are shock waves hitting the ISM.',
    physicalSize: '130 ly diameter (full loop)',
    notableFeatures: ['Part of Cygnus Loop', 'Shock-heated filaments', 'Age 10,000-20,000 years', 'O-III/Ha emission'],
    subObjects: ['NGC 6960 (Western Veil / Witch\'s Broom)', 'Pickering\'s Triangle'],
    discoverer: 'William Herschel', yearDiscovered: 1784,
    morphology: 'Supernova remnant',
    bestSeason: 'Summer', imagingNotes: 'O-III filter transforms this target. Bicolor O-III/Ha is stunning. 30-60s captures filaments.'
  },
};

// ── Constellation → season mapping ─────────────────────────────────

function guessSeason(constellation: string): string {
  const winter = ['Orion','Taurus','Gemini','Canis Major','Canis Minor','Monoceros','Lepus','Auriga','Columba','Eridanus'];
  const spring = ['Leo','Virgo','Coma Berenices','Boötes','Canes Venatici','Corvus','Crater','Hydra','Ursa Major','Leo Minor','Sextans'];
  const summer = ['Scorpius','Sagittarius','Ophiuchus','Lyra','Cygnus','Aquila','Scutum','Serpens','Hercules','Corona Borealis','Libra','Lupus','Norma'];
  const autumn = ['Andromeda','Pegasus','Cassiopeia','Perseus','Cetus','Pisces','Aries','Triangulum','Sculptor','Fornax','Phoenix','Aquarius'];
  if (winter.includes(constellation)) return 'Winter';
  if (spring.includes(constellation)) return 'Spring';
  if (summer.includes(constellation)) return 'Summer';
  if (autumn.includes(constellation)) return 'Autumn';
  return 'Year-round';
}

// ── DSO type normalization ─────────────────────────────────────────

function normalizeDSOType(raw: string): string {
  const t = raw.toLowerCase().trim();
  if (t.includes('galaxy') && t.includes('pair')) return 'galaxy-pair';
  if (t.includes('galaxy') && t.includes('group')) return 'galaxy-group';
  if (t.includes('galaxy') || t === 'g') return 'galaxy';
  if (t.includes('glob') || t === 'gc') return 'globular-cluster';
  if (t.includes('open') || t === 'oc') return 'open-cluster';
  if (t.includes('planetary') || t === 'pn') return 'planetary-nebula';
  if (t.includes('supernova') || t === 'snr') return 'supernova-remnant';
  if (t.includes('emission') || t === 'en') return 'emission-nebula';
  if (t.includes('reflection') || t === 'rn') return 'reflection-nebula';
  if (t.includes('dark') || t === 'dn') return 'dark-nebula';
  if (t.includes('hii') || t === 'hii') return 'hii-region';
  if (t.includes('neb') || t === 'nb') return 'nebula';
  if (t.includes('cluster') || t === 'cl') return 'cluster';
  return 'nebula';
}

// ── Fetch OpenNGC ──────────────────────────────────────────────────

const OPENNGC_URL = 'https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv';

async function fetchDSOCatalog(): Promise<void> {
  console.log('📡 Fetching OpenNGC catalog...');
  const res = await fetch(OPENNGC_URL);
  if (!res.ok) throw new Error(`OpenNGC fetch failed: ${res.status}`);
  const csv = await res.text();
  const rows = parseCSV(csv);
  console.log(`   Parsed ${rows.length} rows from OpenNGC`);

  // Also include all Messier objects by supplementing with our curated list
  const MESSIER_NUMBERS = Array.from({ length: 110 }, (_, i) => i + 1);

  interface DSOOut {
    id: string;
    name: string;
    commonName: string;
    type: string;
    ra: number;
    dec: number;
    magnitude: number;
    size: number;
    constellation: string;
    distanceLY: number | null;
    distancePC: number | null;
    description: string;
    physicalSize: string | null;
    surfaceBrightness: number | null;
    notableFeatures: string[];
    subObjects: string[];
    discoverer: string | null;
    yearDiscovered: number | null;
    morphology: string | null;
    bestSeason: string | null;
    imagingNotes: string | null;
  }

  const seen = new Set<string>();
  const catalog: DSOOut[] = [];

  for (const row of rows) {
    const name = row['Name'] ?? '';
    if (!name) continue;

    // Parse RA (hours:min:sec) and Dec (deg:min:sec)
    const raStr = row['RA'] ?? '';
    const decStr = row['Dec'] ?? '';
    if (!raStr || !decStr) continue;

    const raParts = raStr.split(':').map(Number);
    const ra = (raParts[0] ?? 0) + (raParts[1] ?? 0) / 60 + (raParts[2] ?? 0) / 3600;

    const decParts = decStr.split(':').map((s) => Number(s));
    const decSign = decStr.startsWith('-') ? -1 : 1;
    const dec = decSign * (Math.abs(decParts[0] ?? 0) + (decParts[1] ?? 0) / 60 + (decParts[2] ?? 0) / 3600);

    const mag = parseFloat(row['V-Mag'] || row['B-Mag'] || '');
    if (isNaN(mag) || mag > 14) continue; // limit to observable objects

    const sizeStr = row['MajAx'] ?? '';
    const size = parseFloat(sizeStr) || 0;

    const constellation = row['Const'] ?? '';
    const typeRaw = row['Type'] ?? '';
    const type = normalizeDSOType(typeRaw);

    const messierRaw = row['M'] ?? '';
    const messier = messierRaw ? String(parseInt(messierRaw, 10)) : '';
    const id = messier ? `M${messier}` : name.replace(/\s/g, '');
    if (seen.has(id)) continue;
    seen.add(id);

    const commonNames = row['Common names'] ?? '';
    const commonName = commonNames.split(',')[0]?.trim() ?? '';

    const sbStr = row['SurfBr'] ?? '';
    const surfaceBrightness = parseFloat(sbStr) || null;

    // Hubble morphology for galaxies
    const hubble = row['Hubble'] ?? '';

    // Distance
    const noteStr = row['NED_notes'] ?? row['Notes'] ?? '';
    let distanceLY: number | null = null;
    let distancePC: number | null = null;
    // Try to extract from notes or use enrichment data
    const enrichment = DSO_ENRICHMENTS[id];

    catalog.push({
      id,
      name: messier ? `M${messier}` : name.replace(/\s/g, ''),
      commonName: enrichment ? (commonName || id) : commonName,
      type,
      ra: Math.round(ra * 10000) / 10000,
      dec: Math.round(dec * 1000) / 1000,
      magnitude: Math.round(mag * 10) / 10,
      size: Math.round(size * 10) / 10,
      constellation,
      distanceLY: enrichment?.physicalSize ? null : distanceLY, // will be filled from enrichment
      distancePC: distancePC,
      description: enrichment?.description ?? `${typeRaw} in ${constellation}. Magnitude ${mag.toFixed(1)}.`,
      physicalSize: enrichment?.physicalSize ?? null,
      surfaceBrightness,
      notableFeatures: enrichment?.notableFeatures ?? [],
      subObjects: enrichment?.subObjects ?? [],
      discoverer: enrichment?.discoverer ?? null,
      yearDiscovered: enrichment?.yearDiscovered ?? null,
      morphology: enrichment?.morphology ?? (hubble || null),
      bestSeason: enrichment?.bestSeason ?? guessSeason(constellation),
      imagingNotes: enrichment?.imagingNotes ?? null,
    });
  }

  // Sort: Messier first by number, then NGC by catalog number
  catalog.sort((a, b) => {
    const aM = a.id.startsWith('M') ? parseInt(a.id.slice(1)) : 9999;
    const bM = b.id.startsWith('M') ? parseInt(b.id.slice(1)) : 9999;
    if (aM !== bM) return aM - bM;
    return a.id.localeCompare(b.id);
  });

  const outPath = resolve(CATALOG_DIR, 'dso.json');
  writeFileSync(outPath, JSON.stringify(catalog, null, 2));
  console.log(`✅ Wrote ${catalog.length} DSOs to ${outPath}`);
}

// ── Fetch HYG Stars ────────────────────────────────────────────────

// Codeberg LFS media endpoint (raw/ returns LFS pointer; media/ returns actual file)
const HYG_URL = 'https://codeberg.org/astronexus/hyg/media/branch/main/data/hyg/CURRENT/hyg_v42.csv.gz';

// Star enrichment for well-known stars
interface StarEnrichment {
  description: string;
  distanceLY: number;
  luminosity: string;
  isDouble: boolean;
  doubleCompanion: string | null;
  isVariable: boolean;
  variableType: string | null;
  variablePeriod: string | null;
  hasExoplanets: boolean;
  exoplanetCount: number;
  exoplanetNotes: string | null;
  properMotion: string | null;
  mass: string | null;
  radius: string | null;
  temperature: number | null;
  age: string | null;
  notableFeatures: string[];
}

const STAR_ENRICHMENTS: Record<string, StarEnrichment> = {
  'Sirius': {
    description: 'Brightest star in Earth\'s sky. A binary system — Sirius B (the Pup) was the first white dwarf discovered, confirming stellar evolution theory.',
    distanceLY: 8.6, luminosity: '25.4 L☉',
    isDouble: true, doubleCompanion: 'Sirius B (white dwarf, mag 8.4, period 50 yr)',
    isVariable: false, variableType: null, variablePeriod: null,
    hasExoplanets: false, exoplanetCount: 0, exoplanetNotes: null,
    properMotion: '-546 mas/yr', mass: '2.06 M☉', radius: '1.71 R☉', temperature: 9940, age: '230 Myr',
    notableFeatures: ['Brightest star in night sky', 'Binary with white dwarf', 'Dog Star — Canis Major α', 'Used by ancient Egyptians to predict Nile floods']
  },
  'Canopus': {
    description: 'Second brightest star. An aging giant 310 ly away. Used as a navigation reference by spacecraft due to its brightness and position.',
    distanceLY: 310, luminosity: '10,700 L☉',
    isDouble: false, doubleCompanion: null,
    isVariable: false, variableType: null, variablePeriod: null,
    hasExoplanets: false, exoplanetCount: 0, exoplanetNotes: null,
    properMotion: '30 mas/yr', mass: '8 M☉', radius: '72 R☉', temperature: 7400, age: '25 Myr',
    notableFeatures: ['Spacecraft navigation star', 'Southern hemisphere beacon', 'Supergiant', 'Named after Menelaus\'s helmsman']
  },
  'Arcturus': {
    description: 'Brightest star in the northern hemisphere. An orange giant that has left the main sequence. Its light was used to open the 1933 World\'s Fair.',
    distanceLY: 36.7, luminosity: '170 L☉',
    isDouble: false, doubleCompanion: null,
    isVariable: true, variableType: 'Suspected irregular', variablePeriod: null,
    hasExoplanets: false, exoplanetCount: 0, exoplanetNotes: null,
    properMotion: '-1,093 mas/yr', mass: '1.08 M☉', radius: '25.4 R☉', temperature: 4286, age: '7.1 Gyr',
    notableFeatures: ['Brightest in northern sky', 'High proper motion — Arcturus stream', 'Light opened 1933 World\'s Fair', 'May be from another galaxy (merger remnant)']
  },
  'Vega': {
    description: 'Former pole star (~12,000 BC) and future pole star (~13,700 AD). Surrounded by a debris disk — one of the first stars with an infrared excess detected.',
    distanceLY: 25.0, luminosity: '40 L☉',
    isDouble: false, doubleCompanion: null,
    isVariable: true, variableType: 'Delta Scuti (suspected)', variablePeriod: null,
    hasExoplanets: false, exoplanetCount: 0, exoplanetNotes: 'Debris disk suggests planet formation',
    properMotion: '350 mas/yr', mass: '2.13 M☉', radius: '2.36 R☉', temperature: 9602, age: '455 Myr',
    notableFeatures: ['Magnitude zero-point definition star', 'Debris disk (first detected by IRAS)', 'Former/future pole star', 'Rapid rotator (12.5 hr)', 'Part of Summer Triangle']
  },
  'Rigel': {
    description: 'A blue supergiant 860 ly away, ~120,000× as luminous as the Sun. Will likely end as a supernova. It is actually a quadruple star system.',
    distanceLY: 860, luminosity: '120,000 L☉',
    isDouble: true, doubleCompanion: 'Rigel B (mag 6.7, itself a spectroscopic binary)',
    isVariable: true, variableType: 'Alpha Cygni', variablePeriod: '~25 days',
    hasExoplanets: false, exoplanetCount: 0, exoplanetNotes: null,
    properMotion: '1.3 mas/yr', mass: '21 M☉', radius: '78.9 R☉', temperature: 12100, age: '8 Myr',
    notableFeatures: ['Quadruple star system', 'Blue supergiant', 'Will become supernova', 'Illuminates IC 2118 (Witch Head Nebula)']
  },
  'Betelgeuse': {
    description: 'A red supergiant nearing the end of its life — expected to explode as a supernova within 100,000 years. In 2019-2020, it dimmed dramatically (Great Dimming).',
    distanceLY: 700, luminosity: '126,000 L☉',
    isDouble: false, doubleCompanion: null,
    isVariable: true, variableType: 'Semi-regular (SRc)', variablePeriod: '~420 days + ~5.9 years',
    hasExoplanets: false, exoplanetCount: 0, exoplanetNotes: null,
    properMotion: '27 mas/yr', mass: '16.5 M☉', radius: '887 R☉', temperature: 3600, age: '8-8.5 Myr',
    notableFeatures: ['Will become supernova', 'Great Dimming of 2019-20', 'If placed at Sun, would engulf Jupiter\'s orbit', 'Orion\'s left shoulder']
  },
  'Polaris': {
    description: 'The current North Pole Star, a Cepheid variable. Actually a triple star system. Only 0.7° from the celestial pole, making it invaluable for navigation.',
    distanceLY: 433, luminosity: '1,260 L☉',
    isDouble: true, doubleCompanion: 'Polaris B (mag 8.7, F3V, 18.5" separation)',
    isVariable: true, variableType: 'Classical Cepheid', variablePeriod: '3.97 days',
    hasExoplanets: false, exoplanetCount: 0, exoplanetNotes: null,
    properMotion: '46 mas/yr', mass: '5.4 M☉', radius: '37.5 R☉', temperature: 6015, age: '70 Myr',
    notableFeatures: ['North Pole Star (0.7° from pole)', 'Triple star system', 'Cepheid variable (amplitude decreasing)', 'Navigation star for millennia']
  },
  'Aldebaran': {
    description: 'The "Eye of the Bull" — an orange giant 65 ly away. Not actually part of the Hyades cluster it appears to sit in. One of the four ancient Persian Royal Stars.',
    distanceLY: 65.3, luminosity: '518 L☉',
    isDouble: true, doubleCompanion: 'Aldebaran B (M2V, mag 13.6)',
    isVariable: true, variableType: 'Slow irregular (LB)', variablePeriod: null,
    hasExoplanets: true, exoplanetCount: 1, exoplanetNotes: 'Aldebaran b — ~6.5 Jupiter masses, 1.5 AU, 629-day orbit (disputed)',
    properMotion: '199 mas/yr', mass: '1.16 M☉', radius: '44.2 R☉', temperature: 3910, age: '6.6 Gyr',
    notableFeatures: ['Royal Star of Persia (Watcher of the East)', 'Foreground to Hyades cluster', 'Occultable by Moon', 'Pioneer 10 heading toward it']
  },
  'Fomalhaut': {
    description: 'Surrounded by a dramatic debris disk, one of the most photographed in astronomy. Fomalhaut b was one of the first directly-imaged exoplanet candidates.',
    distanceLY: 25.1, luminosity: '16.6 L☉',
    isDouble: true, doubleCompanion: 'TW PsA (Fomalhaut B, 0.9 ly away) + LP 876-10 (Fomalhaut C, 2.5 ly away)',
    isVariable: false, variableType: null, variablePeriod: null,
    hasExoplanets: true, exoplanetCount: 1, exoplanetNotes: 'Fomalhaut b — first directly imaged exoplanet candidate (now thought to be dust cloud from collision)',
    properMotion: '368 mas/yr', mass: '1.92 M☉', radius: '1.84 R☉', temperature: 8590, age: '440 Myr',
    notableFeatures: ['Spectacular debris disk', '"Eye of Sauron" ring', 'Fomalhaut b controversy', 'Triple star system spanning 5.5 ly']
  },
  'Mizar': {
    description: 'The first telescopic double star discovered (1617). Together with Alcor it forms a naked-eye double. Mizar itself is a quadruple system — six stars total.',
    distanceLY: 78, luminosity: '33.3 L☉',
    isDouble: true, doubleCompanion: 'Mizar B (mag 3.95, 14.4" sep) + Alcor (mag 4.01, 12\' sep). Each component is spectroscopic binary = sextuple system.',
    isVariable: false, variableType: null, variablePeriod: null,
    hasExoplanets: false, exoplanetCount: 0, exoplanetNotes: null,
    properMotion: '122 mas/yr', mass: '2.22 M☉', radius: '2.4 R☉', temperature: 9000, age: '370 Myr',
    notableFeatures: ['First telescopic double (1617)', 'First spectroscopic binary (1889)', 'Sextuple star system with Alcor', 'Eye test in ancient Arab/Roman cultures']
  },
  'Albireo': {
    description: 'The finest colour-contrast double star in the sky — a golden primary and sapphire companion. A showpiece target for any telescope.',
    distanceLY: 430, luminosity: '950 L☉',
    isDouble: true, doubleCompanion: 'Albireo B (mag 5.1, B8V blue, 35" separation)',
    isVariable: false, variableType: null, variablePeriod: null,
    hasExoplanets: false, exoplanetCount: 0, exoplanetNotes: null,
    properMotion: '7 mas/yr', mass: '5 M☉', radius: '69 R☉', temperature: 4270, age: null,
    notableFeatures: ['Finest colour-contrast double', 'Gold + sapphire pair', 'Head of Cygnus (the swan)', 'Uncertain if gravitationally bound']
  },
};

async function fetchStarCatalog(): Promise<void> {
  console.log('📡 Fetching HYG star database (gzipped)...');
  const res = await fetch(HYG_URL);
  if (!res.ok) throw new Error(`HYG fetch failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const csv = gunzipSync(buf).toString('utf8');
  const rows = parseCommaSV(csv);
  console.log(`   Parsed ${rows.length} rows from HYG`);

  interface StarOut {
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

  const catalog: StarOut[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const magStr = row['mag'] ?? '';
    const mag = parseFloat(magStr);
    if (isNaN(mag) || mag > 6.0) continue; // naked-eye stars only

    const raStr = row['ra'] ?? '';
    const decStr = row['dec'] ?? '';
    const ra = parseFloat(raStr);
    const dec = parseFloat(decStr);
    if (isNaN(ra) || isNaN(dec)) continue;

    // Get best name — HYG has 'proper', 'bayer', 'flam', 'bf' (combined), 'con'
    const proper = (row['proper'] ?? '').trim();
    const bayerRaw = (row['bayer'] ?? '').trim();
    const flamRaw = (row['flam'] ?? '').trim();
    const con = (row['con'] ?? '').trim();
    const hr = (row['hr'] ?? '').trim();
    const lum = parseFloat(row['lum'] ?? '');
    const varDesig = (row['var'] ?? '').trim();
    const varMin = parseFloat(row['var_min'] ?? '');
    const varMax = parseFloat(row['var_max'] ?? '');

    let name = proper;
    if (!name && bayerRaw && con) name = `${bayerRaw} ${con}`;
    if (!name && flamRaw && con) name = `${flamRaw} ${con}`;
    if (!name && hr) name = `HR ${hr}`;
    if (!name) continue;

    const id = proper ? proper.toLowerCase().replace(/\s+/g, '-') : `hr-${hr}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const absMag = parseFloat(row['absmag'] ?? '') || 0;
    const ci = parseFloat(row['ci'] ?? '');
    const dist = parseFloat(row['dist'] ?? '');
    const distPC = isNaN(dist) ? null : Math.round(dist * 10) / 10;
    const distLY = distPC !== null ? Math.round(distPC * 3.2616 * 10) / 10 : null;
    const spect = (row['spect'] ?? '').trim();

    const conAbbr = con;
    const enrichment = STAR_ENRICHMENTS[proper] ?? null;

    // Derive luminosity string from HYG 'lum' field if no enrichment
    const lumStr = enrichment?.luminosity ?? (!isNaN(lum) && lum > 0 ? `${lum.toFixed(1)} L☉` : null);

    // Use HYG variable designation if no enrichment
    const isVar = enrichment?.isVariable ?? (varDesig.length > 0);
    const varType = enrichment?.variableType ?? (varDesig || null);

    catalog.push({
      id,
      name,
      ra: Math.round(ra * 10000) / 10000,
      dec: Math.round(dec * 1000) / 1000,
      magnitude: Math.round(mag * 100) / 100,
      absMagnitude: Math.round(absMag * 100) / 100,
      spectralType: spect,
      constellation: conAbbr,
      distanceLY: enrichment?.distanceLY ?? distLY,
      distancePC: distPC,
      colorIndex: isNaN(ci) ? null : Math.round(ci * 100) / 100,
      luminosity: lumStr,
      isDouble: enrichment?.isDouble ?? false,
      doubleCompanion: enrichment?.doubleCompanion ?? null,
      isVariable: isVar,
      variableType: varType,
      variablePeriod: enrichment?.variablePeriod ?? null,
      hasExoplanets: enrichment?.hasExoplanets ?? false,
      exoplanetCount: enrichment?.exoplanetCount ?? 0,
      exoplanetNotes: enrichment?.exoplanetNotes ?? null,
      mass: enrichment?.mass ?? null,
      radius: enrichment?.radius ?? null,
      temperature: enrichment?.temperature ?? null,
      age: enrichment?.age ?? null,
      description: enrichment?.description ?? `${spect} star in ${conAbbr}, magnitude ${mag.toFixed(2)}`,
      notableFeatures: enrichment?.notableFeatures ?? [],
      properMotion: enrichment?.properMotion ?? null,
      bayerDesignation: bayerRaw || null,
      flamsteedNumber: flamRaw || null,
    });
  }

  // Sort by magnitude (brightest first)
  catalog.sort((a, b) => a.magnitude - b.magnitude);

  const outPath = resolve(CATALOG_DIR, 'stars.json');
  writeFileSync(outPath, JSON.stringify(catalog, null, 2));
  console.log(`✅ Wrote ${catalog.length} stars to ${outPath}`);
}

// ── Main ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const doAll = args.includes('--all') || args.length === 0;
const doDSO = doAll || args.includes('--dso');
const doStars = doAll || args.includes('--stars');

(async () => {
  console.log('🔭 Heavenward Catalog Refresh\n');
  try {
    if (doDSO) await fetchDSOCatalog();
    if (doStars) await fetchStarCatalog();
    console.log('\n✨ Done!');
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
})();
