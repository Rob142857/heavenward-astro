import type { GeoLocation, CelestialEvent } from "../types.js";
import {
  getAltAzForRaDec,
  angularSeparation,
  azimuthToCompass,
  azimuthToCompassShort,
  altitudeDescription,
  getRiseSetForRaDec,
} from "./astro.js";
import { loadDSOCatalog } from "../catalog/dso.js";
import { loadStarCatalog } from "../catalog/stars.js";
import { METEOR_SHOWERS } from "../catalog/meteors.js";

// ── Types ──────────────────────────────────────────────────────────

export interface NearbyObject {
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
  target: {
    name: string;
    lookDirection: string;
    compassShort: string;
    altDescription: string;
    altitude: number;
    azimuth: number;
    constellation: string | null;
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
    return emptyContext(event);
  }

  const [dsos, stars] = await Promise.all([
    loadDSOCatalog(),
    loadStarCatalog(),
  ]);

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
    target: {
      name: event.name,
      lookDirection: compass,
      compassShort,
      altDescription: altDesc,
      altitude: alt,
      azimuth: az,
      constellation: event.constellation,
    },
    nearby,
    constellationObjects,
    photographyTips,
    lookingDescription,
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

function emptyContext(event: CelestialEvent): SkyContext {
  return {
    target: {
      name: event.name,
      lookDirection: "unknown",
      compassShort: "—",
      altDescription: "unknown",
      altitude: 0,
      azimuth: 0,
      constellation: null,
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
