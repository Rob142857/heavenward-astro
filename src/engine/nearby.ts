import type { GeoLocation, CelestialEvent } from "../types.js";
import {
  getAltAzForRaDec,
  angularSeparation,
  azimuthToCompass,
  azimuthToCompassShort,
  altitudeDescription,
  getRiseSetForRaDec,
  getMoonSummary,
} from "./astro.js";
import { loadDSOCatalog } from "../catalog/dso.js";
import type { DSOEntry } from "../catalog/dso.js";
import { loadStarCatalog } from "../catalog/stars.js";
import type { StarEntry } from "../catalog/stars.js";
import { METEOR_SHOWERS } from "../catalog/meteors.js";
import { getMythologyForConstellation } from "../catalog/mythology.js";
import type { MythologyEntry } from "../catalog/mythology.js";
import { getHistoryForConstellation } from "../catalog/history.js";
import type { HistoryEntry } from "../catalog/history.js";
import { getNamesakesForStar } from "../catalog/namesakes.js";
import type { NamesakeEntry } from "../catalog/namesakes.js";
import { constellationCode } from "../catalog/constellations.js";

// ── Types ──────────────────────────────────────────────────────────

// Fields sourced straight from the DSO/star catalog entries — already
// shipped in dso.json/stars.json but previously never made it into the LLM
// prompt. Optional because meteor showers/planets/stars don't populate all
// of them (e.g. only DSOs have discoverer/morphology).
export interface CatalogRichDetails {
  description?: string;
  notableFeatures?: string[];
  discoverer?: string | null;
  yearDiscovered?: number | null;
  morphology?: string | null;
  imagingNotes?: string | null;
  subObjects?: string[];
}

export interface NearbyObject extends CatalogRichDetails {
  id: string;
  name: string;
  type: string;
  brief: string;
  separation: number; // degrees
  direction: string; // e.g. "above and to the right"
  altitude: number;
  azimuth: number;
  magnitude: number | null;
  constellation: string | null;
  ra: number;
  dec: number;
}

export interface SkyContext {
  /**
   * Where the user is standing. Without this the language model had no idea
   * which hemisphere it was describing and fell back on the northern-sky
   * assumptions that dominate its training data — telling a viewer in
   * Australia that Crux was not visible to them, when from that latitude it
   * is circumpolar and never sets. All of this stays on the device.
   */
  observer: {
    latitude: number;
    longitude: number;
    hemisphere: "northern" | "southern";
    /** Highest declination that never sets from here, and lowest that never
     *  rises — the two facts that decide what this observer can ever see. */
    circumpolarBelowDec: number;
    neverRisesAboveDec: number;
  };
  /**
   * What kind of observing night this is. Grounds the guide's opening in
   * the actual date, hemisphere-correct season and moon — without this the
   * model either says nothing seasonal or guesses from its (northern-biased)
   * training data, and "a crisp winter evening" in an Australian August is
   * exactly the kind of small wrongness that erodes trust in the rest.
   */
  night: {
    /** e.g. "11 August" — kept in English, like the rest of the prompt. */
    date: string;
    /** Season at the OBSERVER's hemisphere, e.g. "winter" for August at
     *  -35°. Astronomical enough for prose; not a solstice calculator. */
    season: string;
    moonPhaseName: string;
    /** 0..1 illuminated fraction — the single biggest factor in what is
     *  actually observable tonight. */
    moonIllumination: number;
  };
  target: CatalogRichDetails & {
    name: string;
    lookDirection: string;
    compassShort: string;
    altDescription: string;
    altitude: number;
    azimuth: number;
    constellation: string | null;
    /** Present only when a sourced Campbell entry exists for this
     *  constellation — most won't have one. Never invent when absent. */
    mythology?: MythologyEntry;
    /** Documented historical-astronomy facts for this constellation, if
     *  any — usually empty. */
    history: HistoryEntry[];
    /** Ships, rockets, telescopes and the like that took this star's name.
     *  Empty for all but ~11 of the brightest stars. */
    namesakes: NamesakeEntry[];
  };
  nearby: NearbyObject[];
  constellationObjects: NearbyObject[];
  photographyTips: string[];
  lookingDescription: string;
}

// ── Relative direction between two sky positions ──────────────────

function relativeDirection(
  fromAlt: number,
  fromAz: number,
  toAlt: number,
  toAz: number,
): string {
  let dAz = toAz - fromAz;
  if (dAz > 180) dAz -= 360;
  if (dAz < -180) dAz += 360;

  const dAlt = toAlt - fromAlt;
  const parts: string[] = [];

  if (Math.abs(dAlt) > 3) parts.push(dAlt > 0 ? "above" : "below");
  if (Math.abs(dAz) > 3) parts.push(dAz > 0 ? "to the right" : "to the left");

  return parts.length ? parts.join(" and ") : "very close";
}

// ── Photography tip generator ─────────────────────────────────────

function getPhotoTips(
  event: CelestialEvent,
  nearby: NearbyObject[],
): string[] {
  const tips: string[] = [];
  const alt = event.altitude ?? 0;
  const mag = event.magnitude;

  if (alt < 20) {
    tips.push(
      "Low altitude means more atmospheric distortion — images may appear reddened or blurred.",
    );
  }
  if (alt > 60) {
    tips.push(
      "High altitude is ideal — minimal atmospheric interference for sharp images.",
    );
  }

  if (event.type === "dso") {
    const catType = event.extra.catalogType as string | undefined;
    if (catType?.includes("nebula") || catType?.includes("emission")) {
      tips.push(
        "Nebulae respond well to narrowband filters (Ha, OIII). Try 30-120s exposures.",
      );
    }
    if (catType?.includes("galaxy")) {
      tips.push(
        "Galaxies need long exposures (60-300s) at high ISO/gain. Stack multiple frames for detail.",
      );
    }
    if (catType?.includes("cluster")) {
      tips.push(
        "Star clusters look great at moderate focal lengths. Short exposures (5-30s) prevent trailing.",
      );
    }
  }

  if (event.type === "planet") {
    tips.push(
      "Planets are bright — use short exposures or video stacking (lucky imaging) for detail.",
    );
  }

  if (event.type === "meteor-shower") {
    tips.push(
      "Use a wide-angle lens pointed near but not directly at the radiant. 15-30s exposures at high ISO.",
    );
    tips.push(
      "A tripod and intervalometer let you capture hundreds of frames to catch streaks.",
    );
  }

  if (mag !== null && mag > 8) {
    tips.push(
      `At magnitude ${mag.toFixed(1)}, this object is invisible to the naked eye — a telescope or long exposure is needed.`,
    );
  } else if (mag !== null && mag > 6) {
    tips.push(
      `Magnitude ${mag.toFixed(1)} is at the limit of naked-eye visibility — binoculars recommended.`,
    );
  }

  const brightNearby = nearby.filter(
    (n) => n.magnitude !== null && n.magnitude < 3 && n.separation < 15,
  );
  if (brightNearby.length) {
    const names = brightNearby.map((n) => n.name).join(", ");
    tips.push(
      `Bright stars nearby (${names}) make good framing references and guide stars.`,
    );
  }

  return tips;
}

// ── Main sky context builder ──────────────────────────────────────

export async function buildSkyContext(
  event: CelestialEvent,
  loc: GeoLocation,
  date: Date,
  radiusDeg = 20,
  maxResults = 12,
): Promise<SkyContext> {
  const targetRA = event.ra;
  const targetDec = event.dec;

  if (targetRA === null || targetDec === null) {
    return emptyContext(event, loc, date);
  }

  // Normalise first: the star/DSO catalogs store the IAU code ("UMa") while
  // the solar-system engine reports the full name ("Ursa Major"), and the
  // myth/history catalogs are keyed by code. Looking up the raw value meant
  // planets and the Moon could never match a mythology entry at all.
  const constellation = constellationCode(event.constellation);

  // Namesakes key off the proper star name, not the constellation, so that
  // "there is a neutrino telescope named Antares" appears on Antares and
  // nowhere else in Scorpius.
  const [dsos, stars, mythology, history, namesakes] = await Promise.all([
    loadDSOCatalog(),
    loadStarCatalog(),
    getMythologyForConstellation(constellation),
    getHistoryForConstellation(constellation),
    getNamesakesForStar(event.name),
  ]);

  // The target itself may be a DSO/star with rich catalog fields (description,
  // discoverer, notableFeatures, ...) that CelestialEvent doesn't carry — look
  // it up directly rather than threading everything through `extra` at every
  // event-construction call site.
  const targetDetails = findRichDetails(event, dsos, stars);

  const candidates: NearbyObject[] = [];

  // DSOs
  for (const d of dsos) {
    if (d.id === event.id.replace("dso-", "")) continue;
    const sep = angularSeparation(targetRA, targetDec, d.ra, d.dec);
    if (sep > radiusDeg) continue;
    const hor = getAltAzForRaDec(d.ra, d.dec, loc, date);
    if (hor.altitude < -5) continue;

    candidates.push({
      id: `dso-${d.id}`,
      name: d.commonName || d.name,
      type: d.type,
      brief: d.description.slice(0, 80),
      separation: sep,
      direction: relativeDirection(
        event.altitude ?? 0,
        event.azimuth ?? 0,
        hor.altitude,
        hor.azimuth,
      ),
      altitude: hor.altitude,
      azimuth: hor.azimuth,
      magnitude: d.magnitude,
      constellation: d.constellation,
      ra: d.ra,
      dec: d.dec,
      description: d.description,
      notableFeatures: d.notableFeatures,
      discoverer: d.discoverer,
      yearDiscovered: d.yearDiscovered,
      morphology: d.morphology,
      imagingNotes: d.imagingNotes,
      subObjects: d.subObjects,
    });
  }

  // Stars
  for (const s of stars) {
    if (s.id === event.id.replace("star-", "")) continue;
    const sep = angularSeparation(targetRA, targetDec, s.ra, s.dec);
    if (sep > radiusDeg) continue;
    const hor = getAltAzForRaDec(s.ra, s.dec, loc, date);
    if (hor.altitude < -5) continue;

    candidates.push({
      id: `star-${s.id}`,
      name: s.name,
      type: "star",
      brief: `${s.spectralType} star, mag ${s.magnitude.toFixed(1)}`,
      separation: sep,
      direction: relativeDirection(
        event.altitude ?? 0,
        event.azimuth ?? 0,
        hor.altitude,
        hor.azimuth,
      ),
      altitude: hor.altitude,
      azimuth: hor.azimuth,
      magnitude: s.magnitude,
      constellation: s.constellation,
      ra: s.ra,
      dec: s.dec,
      description: s.description,
      notableFeatures: s.notableFeatures,
    });
  }

  // Active meteor shower radiants
  const month = date.getMonth() + 1;
  const day = date.getDate();
  for (const m of METEOR_SHOWERS) {
    if (m.id === event.id.replace("meteor-", "")) continue;
    if (!isShowerActive(m, month, day)) continue;
    const sep = angularSeparation(
      targetRA,
      targetDec,
      m.radiantRA,
      m.radiantDec,
    );
    if (sep > radiusDeg) continue;
    const hor = getAltAzForRaDec(m.radiantRA, m.radiantDec, loc, date);
    candidates.push({
      id: `meteor-${m.id}`,
      name: m.name,
      type: "meteor-shower",
      brief: `ZHR ${m.zhr}, parent: ${m.parentBody}`,
      separation: sep,
      direction: relativeDirection(
        event.altitude ?? 0,
        event.azimuth ?? 0,
        hor.altitude,
        hor.azimuth,
      ),
      altitude: hor.altitude,
      azimuth: hor.azimuth,
      magnitude: null,
      constellation: null,
      ra: m.radiantRA,
      dec: m.radiantDec,
    });
  }

  // Sort by separation, take closest
  candidates.sort((a, b) => a.separation - b.separation);
  const nearby = candidates.slice(0, maxResults);

  // Objects in same constellation
  const constellationObjects = candidates
    .filter(
      (c) =>
        c.constellation &&
        event.constellation &&
        c.constellation === event.constellation,
    )
    .slice(0, 6);

  const alt = event.altitude ?? 0;
  const az = event.azimuth ?? 0;
  const compass = azimuthToCompass(az);
  const compassShort = azimuthToCompassShort(az);
  const altDesc = altitudeDescription(alt);

  const lookingDescription = buildLookingDescription(
    event,
    compass,
    alt,
    altDesc,
    nearby,
  );

  const photographyTips = getPhotoTips(event, nearby);

  return {
    observer: describeObserver(loc),
    night: describeNight(loc, date),
    target: {
      name: event.name,
      lookDirection: compass,
      compassShort,
      altDescription: altDesc,
      altitude: alt,
      azimuth: az,
      constellation: event.constellation,
      ...targetDetails,
      mythology,
      history,
      namesakes,
    },
    nearby,
    constellationObjects,
    photographyTips,
    lookingDescription,
  };
}

/**
 * What this observer's latitude means for what they can ever see. A star is
 * permanently above the horizon when its declination exceeds 90° − |latitude|
 * on the observer's own side of the sky, and permanently below when it
 * exceeds that on the far side. From Wagga Wagga (−35°) that makes anything
 * south of −55° circumpolar, which is why Crux never sets there.
 */
function describeObserver(loc: GeoLocation): SkyContext["observer"] {
  const limit = 90 - Math.abs(loc.lat);
  const southern = loc.lat < 0;
  return {
    latitude: loc.lat,
    longitude: loc.lon,
    hemisphere: southern ? "southern" : "northern",
    circumpolarBelowDec: southern ? -limit : limit,
    neverRisesAboveDec: southern ? limit : -limit,
  };
}

const SEASONS_NORTH = ["winter", "spring", "summer", "autumn"] as const;

function describeNight(loc: GeoLocation, date: Date): SkyContext["night"] {
  // Meteorological quarters (Dec-Feb, Mar-May, ...) — right-enough naming
  // for prose, flipped for the southern hemisphere.
  const quarter = Math.floor(((date.getMonth() + 1) % 12) / 3);
  const season =
    loc.lat < 0 ? SEASONS_NORTH[(quarter + 2) % 4] : SEASONS_NORTH[quarter];
  const moon = getMoonSummary(date);
  return {
    date: date.toLocaleDateString("en-GB", { day: "numeric", month: "long" }),
    season,
    moonPhaseName: moon.phaseName,
    moonIllumination: moon.illumination,
  };
}

// ── Natural-language looking description (template-based) ─────────

function buildLookingDescription(
  event: CelestialEvent,
  compass: string,
  alt: number,
  altDesc: string,
  nearby: NearbyObject[],
): string {
  const parts: string[] = [];

  parts.push(
    `Face ${compass} and look ${altDesc} (about ${Math.round(alt)}° above the horizon).`,
  );

  if (event.constellation) {
    parts.push(`${event.name} is in the constellation ${event.constellation}.`);
  }

  // Mention bright nearby stars as waypoints
  const brightStars = nearby
    .filter((n) => n.type === "star" && n.magnitude !== null && n.magnitude < 3)
    .slice(0, 3);

  if (brightStars.length) {
    const waypoints = brightStars
      .map(
        (s) =>
          `${s.name} (mag ${s.magnitude?.toFixed(1)}, ${s.separation.toFixed(1)}° away, ${s.direction})`,
      )
      .join("; ");
    parts.push(`Nearby bright stars to help navigate: ${waypoints}.`);
  }

  // Mention interesting DSOs
  const dsos = nearby
    .filter((n) => n.type !== "star" && n.type !== "meteor-shower")
    .slice(0, 3);
  if (dsos.length) {
    const dsoList = dsos
      .map(
        (d) =>
          `${d.name} (${d.type}, ${d.separation.toFixed(1)}° ${d.direction})`,
      )
      .join("; ");
    parts.push(`Interesting deep-sky objects nearby: ${dsoList}.`);
  }

  return parts.join(" ");
}

// ── Helpers ────────────────────────────────────────────────────────

/** Look up the target event's own catalog entry for its rich fields, if it
 *  is a DSO or star (planets/moon/meteor showers have none of these). */
function findRichDetails(
  event: CelestialEvent,
  dsos: DSOEntry[],
  stars: StarEntry[],
): CatalogRichDetails {
  if (event.id.startsWith("dso-")) {
    const d = dsos.find((x) => x.id === event.id.replace("dso-", ""));
    if (!d) return {};
    return {
      description: d.description,
      notableFeatures: d.notableFeatures,
      discoverer: d.discoverer,
      yearDiscovered: d.yearDiscovered,
      morphology: d.morphology,
      imagingNotes: d.imagingNotes,
      subObjects: d.subObjects,
    };
  }
  if (event.id.startsWith("star-")) {
    const s = stars.find((x) => x.id === event.id.replace("star-", ""));
    if (!s) return {};
    return { description: s.description, notableFeatures: s.notableFeatures };
  }
  return {};
}

function emptyContext(
  event: CelestialEvent,
  loc: GeoLocation,
  date: Date,
): SkyContext {
  return {
    observer: describeObserver(loc),
    night: describeNight(loc, date),
    target: {
      name: event.name,
      lookDirection: "unknown",
      compassShort: "—",
      altDescription: "unknown",
      altitude: 0,
      azimuth: 0,
      constellation: null,
      history: [],
      namesakes: [],
    },
    nearby: [],
    constellationObjects: [],
    photographyTips: [],
    lookingDescription: "Position data not available for this object.",
  };
}

function isShowerActive(
  s: { startMonth: number; startDay: number; endMonth: number; endDay: number },
  m: number,
  d: number,
): boolean {
  const start = s.startMonth * 100 + s.startDay;
  const end = s.endMonth * 100 + s.endDay;
  const now = m * 100 + d;
  if (start <= end) return now >= start && now <= end;
  return now >= start || now <= end;
}
