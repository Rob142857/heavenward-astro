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
import { loadHistoryCatalog } from "../catalog/history.js";
import type { HistoryEntry } from "../catalog/history.js";
import { getNamesakesForStar } from "../catalog/namesakes.js";
import type { NamesakeEntry } from "../catalog/namesakes.js";
import {
  constellationCode,
  constellationName,
} from "../catalog/constellations.js";
import { t } from "../i18n/translations.js";

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

export type SkyDataSource =
  | "deep-sky"
  | "stars"
  | "mythology"
  | "history"
  | "namesakes";

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
    /** Civil time zones are not available offline for arbitrary manual
     * coordinates, so this is explicitly approximate local solar time. */
    localSolarTime: string;
    utcTime: string;
  };
  target: CatalogRichDetails & {
    name: string;
    lookDirection: string;
    compassShort: string;
    altDescription: string;
    altitude: number;
    azimuth: number;
    constellation: string | null;
    riseUTC: string | null;
    setUTC: string | null;
    transitUTC: string | null;
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
  /** Sourced history attached to other constellations that are genuinely
   * visible around the target right now. This gives the AI a wider human-sky
   * view without dumping the entire catalog into a small context window. */
  visibleHistory: HistoryEntry[];
  photographyTips: string[];
  lookingDescription: string;
  /**
   * Catalogs are useful enrichment, but none is allowed to take the whole
   * guide down. A stale deployment chunk or a brief network failure should
   * still leave the user with correct direction, altitude and observing
   * context. The UI uses this list to explain that enrichment is partial and
   * offer a retry instead of silently leaving a skeleton on screen.
   */
  unavailableSources: SkyDataSource[];
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
  const vertical = Math.abs(dAlt) > 3 ? (dAlt > 0 ? "above" : "below") : "";
  const horizontal =
    Math.abs(dAz) > 3 ? (dAz > 0 ? "right" : "left") : "";
  const key = vertical && horizontal
    ? `${vertical}${horizontal === "right" ? "Right" : "Left"}`
    : vertical || horizontal || "veryClose";
  return t(`detail.relative.${key}`);
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
    tips.push(t("detail.photo.lowAltitude"));
  }
  if (alt > 60) {
    tips.push(t("detail.photo.highAltitude"));
  }

  if (event.type === "dso") {
    const catType = event.extra.catalogType as string | undefined;
    if (catType?.includes("nebula") || catType?.includes("emission")) {
      tips.push(t("detail.photo.nebula"));
    }
    if (catType?.includes("galaxy")) {
      tips.push(t("detail.photo.galaxy"));
    }
    if (catType?.includes("cluster")) {
      tips.push(t("detail.photo.cluster"));
    }
  }

  if (event.type === "planet") {
    tips.push(t("detail.photo.planet"));
  }

  if (event.type === "meteor-shower") {
    tips.push(t("detail.photo.meteorWide"));
    tips.push(t("detail.photo.meteorTripod"));
  }

  if (mag !== null && mag > 8) {
    tips.push(t("detail.photo.faint", { magnitude: mag.toFixed(1) }));
  } else if (mag !== null && mag > 6) {
    tips.push(t("detail.photo.binocular", { magnitude: mag.toFixed(1) }));
  }

  const brightNearby = nearby.filter(
    (n) => n.magnitude !== null && n.magnitude < 3 && n.separation < 15,
  );
  if (brightNearby.length) {
    const names = brightNearby.map((n) => n.name).join(", ");
    tips.push(t("detail.photo.guideStars", { names }));
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
  const [dsoResult, starResult, mythologyResult, historyResult, namesakeResult] =
    await Promise.allSettled([
      loadDSOCatalog(),
      loadStarCatalog(),
      getMythologyForConstellation(constellation),
      loadHistoryCatalog(),
      getNamesakesForStar(event.name),
    ]);

  const unavailableSources: SkyDataSource[] = [];
  const catalogValue = <T>(
    result: PromiseSettledResult<T>,
    fallback: T,
    source: SkyDataSource,
  ): T => {
    if (result.status === "fulfilled") return result.value;
    unavailableSources.push(source);
    console.warn(`[Sky Guide] ${source} catalog unavailable`, result.reason);
    return fallback;
  };

  const dsos = catalogValue(dsoResult, [] as DSOEntry[], "deep-sky");
  const stars = catalogValue(starResult, [] as StarEntry[], "stars");
  const mythology = catalogValue(
    mythologyResult,
    undefined as MythologyEntry | undefined,
    "mythology",
  );
  const historyCatalog = catalogValue(
    historyResult,
    [] as HistoryEntry[],
    "history",
  );
  const history = historyCatalog.filter(
    (entry) => entry.constellation === constellation,
  );
  const namesakes = catalogValue(
    namesakeResult,
    [] as NamesakeEntry[],
    "namesakes",
  );

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
    if (hor.altitude < 0) continue;

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
    if (hor.altitude < 0) continue;

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
    if (hor.altitude < 0) continue;
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
        constellation &&
        constellationCode(c.constellation) === constellation,
    )
    .slice(0, 6);

  const visibleConstellations = new Set(
    candidates
      .map((candidate) => constellationCode(candidate.constellation))
      .filter((code): code is string => Boolean(code)),
  );
  const visibleObjectNames = new Set(candidates.map((candidate) => candidate.name));
  const visibleHistory = historyCatalog.filter(
    (entry) =>
      entry.constellation !== constellation &&
      visibleConstellations.has(entry.constellation) &&
      (!entry.starName || visibleObjectNames.has(entry.starName)),
  );

  const alt = event.altitude ?? 0;
  const az = event.azimuth ?? 0;
  const compass = azimuthToCompass(az);
  const compassShort = azimuthToCompassShort(az);
  const altDesc = altitudeDescription(alt);

  const lookingDescription = buildLookingDescription(
    event,
    compassShort,
    alt,
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
      constellation: constellationName(event.constellation),
      riseUTC: formatUTCTime(event.rise),
      setUTC: formatUTCTime(event.set),
      transitUTC: formatUTCTime(event.transit),
      ...targetDetails,
      mythology,
      history,
      namesakes,
    },
    nearby,
    constellationObjects,
    visibleHistory,
    photographyTips,
    lookingDescription,
    unavailableSources,
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
  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  const solarMinutes = Math.round(
    ((utcMinutes + loc.lon * 4) % 1440 + 1440) % 1440,
  );
  return {
    date: date.toLocaleDateString("en-GB", { day: "numeric", month: "long" }),
    season,
    moonPhaseName: moon.phaseName,
    moonIllumination: moon.illumination,
    localSolarTime: `${String(Math.floor(solarMinutes / 60)).padStart(2, "0")}:${String(solarMinutes % 60).padStart(2, "0")}`,
    utcTime: `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`,
  };
}

function formatUTCTime(value: Date | null): string | null {
  if (!value) return null;
  return `${String(value.getUTCHours()).padStart(2, "0")}:${String(value.getUTCMinutes()).padStart(2, "0")}`;
}

/** A translated, reader-facing label for the catalog's stable type code. */
export function nearbyObjectTypeLabel(type: string): string {
  switch (type) {
    case "star":
      return t("search.chip.namedStar");
    case "meteor-shower":
      return t("search.chip.meteor");
    case "galaxy":
    case "galaxy-pair":
    case "galaxy-group":
      return t("search.chip.galaxy");
    case "planetary-nebula":
      return t("search.chip.planetaryNebula");
    case "supernova-remnant":
      return t("search.chip.supernovaRemnant");
    case "open-cluster":
    case "cluster":
      return t("search.chip.openCluster");
    case "globular-cluster":
      return t("search.chip.globularCluster");
    case "hii-region":
      return t("search.chip.hiiRegion");
    case "nebula":
    case "emission-nebula":
    case "reflection-nebula":
    case "dark-nebula":
      return t("search.chip.nebula");
    default:
      return type;
  }
}

// ── Natural-language looking description (template-based) ─────────

function buildLookingDescription(
  event: CelestialEvent,
  compass: string,
  alt: number,
  nearby: NearbyObject[],
): string {
  const parts: string[] = [];

  parts.push(t("detail.skyGuide.look", { direction: compass, altitude: Math.round(alt) }));

  if (event.constellation) {
    parts.push(
      t("detail.skyGuide.inConstellation", {
        name: event.name,
        constellation: constellationName(event.constellation) ?? event.constellation,
      }),
    );
  }

  // Mention bright nearby stars as waypoints
  const brightStars = nearby
    .filter((n) => n.type === "star" && n.magnitude !== null && n.magnitude < 3)
    .slice(0, 3);

  if (brightStars.length) {
    const waypoints = brightStars
      .map(
        (s) =>
          t("detail.skyGuide.waypoint", {
            name: s.name,
            magnitude: s.magnitude?.toFixed(1) ?? "?",
            separation: s.separation.toFixed(1),
            direction: s.direction,
          }),
      )
      .join("; ");
    parts.push(t("detail.skyGuide.waypoints", { objects: waypoints }));
  }

  // Mention interesting DSOs
  const dsos = nearby
    .filter((n) => n.type !== "star" && n.type !== "meteor-shower")
    .slice(0, 3);
  if (dsos.length) {
    const dsoList = dsos
      .map(
        (d) =>
          t("detail.skyGuide.nearbyObject", {
            name: d.name,
            type: nearbyObjectTypeLabel(d.type),
            separation: d.separation.toFixed(1),
            direction: d.direction,
          }),
      )
      .join("; ");
    parts.push(t("detail.skyGuide.deepSkyNearby", { objects: dsoList }));
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
      riseUTC: null,
      setUTC: null,
      transitUTC: null,
      history: [],
      namesakes: [],
    },
    nearby: [],
    constellationObjects: [],
    visibleHistory: [],
    photographyTips: [],
    lookingDescription: t("detail.skyGuide.positionUnavailable"),
    unavailableSources: [],
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
