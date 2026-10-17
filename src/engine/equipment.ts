/**
 * "What do I need to see it?" One rule for the whole app: the Tonight's Best
 * equipment filter and the verdict row on object pages both call
 * equipmentClass(), so they can never disagree.
 *
 * Pure (no DOM, no astronomy-engine), so it runs in Node tests.
 */

export type EquipmentClass =
  | "naked-eye"
  | "binoculars"
  | "small-scope"
  | "smart-scope";

/** Ordered smallest to largest: an object that needs binoculars also shows
 *  in a small scope or a smart telescope. */
export const EQUIPMENT_CLASSES: EquipmentClass[] = [
  "naked-eye",
  "binoculars",
  "small-scope",
  "smart-scope",
];

export type TargetKind = "planet" | "moon" | "star" | "dso";

export interface VisualTarget {
  kind: TargetKind;
  /** Visual (V) magnitude; null when unknown. */
  mag: number | null;
  /** DSO type from the catalogue (galaxy, open-cluster, ...). */
  dsoType?: string | null;
  /** Major axis, arcminutes. */
  size?: number | null;
  /** Minor axis, arcminutes. */
  minor?: number | null;
  /** Catalogue surface brightness, mag/arcsec² (OpenNGC SurfBr). */
  surfaceBrightness?: number | null;
  /** A floor set by something other than brightness, e.g. a double star's
   *  separation: the target needs at least this equipment. */
  needs?: EquipmentClass;
}

/**
 * Limits per class. Magnitudes are the faintest object of that kind the
 * equipment shows from a reasonably dark (rural) sky; surface brightness is
 * the faintest mag/arcsec² for extended objects. Sources for the round
 * figures: naked-eye stars to ~6 (DSOs ~1 mag brighter, because their light
 * is spread out); 7x50 binoculars to ~9 (DSOs ~8); a 100-150 mm scope to
 * ~12 (DSOs ~11.5); a smart telescope like the Seestar S50 stacks exposures
 * and reaches the catalogue's mag 14 cut and faint surface brightness.
 */
export const EQUIPMENT_LIMITS: Record<
  EquipmentClass,
  { star: number; dso: number; sb: number }
> = {
  "naked-eye": { star: 5.5, dso: 5.0, sb: 24.0 },
  binoculars: { star: 9.0, dso: 8.0, sb: 24.0 },
  "small-scope": { star: 12.0, dso: 11.5, sb: 24.5 },
  "smart-scope": { star: 14.0, dso: 14.0, sb: 26.0 },
};

/** Extended objects smaller than this (arcmin) need a telescope. */
export const SMALL_ARCMIN = 1.5;

/** Types whose light is spread out, so surface brightness matters. */
const EXTENDED_TYPES = new Set([
  "galaxy",
  "galaxy-pair",
  "galaxy-group",
  "nebula",
  "emission-nebula",
  "reflection-nebula",
  "dark-nebula",
  "hii-region",
  "supernova-remnant",
  "planetary-nebula",
]);

export function isExtended(t: VisualTarget): boolean {
  return t.kind === "dso" && !!t.dsoType && EXTENDED_TYPES.has(t.dsoType);
}

/**
 * Mean surface brightness in mag/arcsec²: the catalogue figure when there is
 * one, else from magnitude and an elliptical area,
 * SB = m + 2.5 log10(pi/4 * a * b * 3600) with a and b in arcminutes.
 */
export function surfaceBrightness(t: VisualTarget): number | null {
  if (t.surfaceBrightness !== null && t.surfaceBrightness !== undefined)
    return t.surfaceBrightness;
  if (t.mag === null || !t.size || t.size <= 0) return null;
  const minor = t.minor && t.minor > 0 ? t.minor : t.size;
  const areaArcsec2 = (Math.PI / 4) * t.size * minor * 3600;
  return t.mag + 2.5 * Math.log10(areaArcsec2);
}

/** Does `cls` show this target? */
export function showsWith(t: VisualTarget, cls: EquipmentClass): boolean {
  if (t.needs && !classWithin(t.needs, cls)) return false;
  if (t.kind === "moon") return true;
  if (t.mag === null) return cls !== "naked-eye";
  const lim = EQUIPMENT_LIMITS[cls];
  if (t.kind === "planet" || t.kind === "star") return t.mag <= lim.star;
  if (t.mag > lim.dso) return false;
  if (isExtended(t)) {
    // Under 1.5' a nebula or galaxy looks like a star without magnification.
    if (t.size && t.size < SMALL_ARCMIN && (cls === "naked-eye" || cls === "binoculars"))
      return false;
    const sb = surfaceBrightness(t);
    if (sb !== null && sb > lim.sb) return false;
  }
  return true;
}

/** The least equipment that shows the target. */
export function equipmentClass(t: VisualTarget): EquipmentClass {
  for (const cls of EQUIPMENT_CLASSES) if (showsWith(t, cls)) return cls;
  return "smart-scope";
}

/** True when `need` is within what `have` can do. */
export function classWithin(need: EquipmentClass, have: EquipmentClass): boolean {
  return EQUIPMENT_CLASSES.indexOf(need) <= EQUIPMENT_CLASSES.indexOf(have);
}

/**
 * How comfortably `have` shows the target, 0 (at the limit) to 1 (easy).
 * By type: the Moon is always 1; planets, stars and clusters use the
 * magnitude margin; extended objects average the magnitude and surface
 * brightness margins. A 4-magnitude (or 3 mag/arcsec²) margin counts as easy.
 */
export function brightnessScore(t: VisualTarget, have: EquipmentClass): number {
  if (t.kind === "moon") return 1;
  if (t.mag === null) return 0.5;
  const lim = EQUIPMENT_LIMITS[have];
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  const magLimit = t.kind === "dso" ? lim.dso : lim.star;
  const magScore = clamp((magLimit - t.mag) / 4);
  if (!isExtended(t)) return magScore;
  const sb = surfaceBrightness(t);
  if (sb === null) return magScore;
  const sbScore = clamp((lim.sb - sb) / 3);
  return (magScore + sbScore) / 2;
}

// ── Best month ──────────────────────────────────────────────────────

/**
 * The month the object transits at local midnight, which is when it is up
 * all night. The Sun's right ascension is 0h at the March equinox and moves
 * about 2h a month, so midnight transit falls when the Sun sits at RA + 12h.
 * Works the same in both hemispheres (it is about the Sun, not the season);
 * `lat` decides only whether the object rises at all.
 * Returns 1-12, or null when it never rises at `lat`.
 */
export function bestMonth(ra: number, dec: number, lat: number): number | null {
  if (neverRises(dec, lat)) return null;
  const sunRa = (((ra + 12) % 24) + 24) % 24;
  // The Sun takes 187 days from the March equinox (RA 0h) to the September
  // one (RA 12h), and 178 days back, so interpolate within each half.
  const MAR = Date.UTC(2026, 2, 20);
  const SEP = Date.UTC(2026, 8, 23);
  const at =
    sunRa < 12
      ? MAR + (sunRa / 12) * 187 * 86_400_000
      : SEP + ((sunRa - 12) / 12) * 178 * 86_400_000;
  return new Date(at).getUTCMonth() + 1;
}

function neverRises(dec: number, lat: number): boolean {
  return lat >= 0 ? dec < lat - 90 : dec > lat + 90;
}

/** Season word for `month` in the observer's hemisphere (meteorological). */
export function seasonFor(
  month: number,
  lat: number,
): "summer" | "autumn" | "winter" | "spring" {
  const north = ["winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "autumn", "autumn", "autumn", "winter"] as const;
  const south = ["summer", "summer", "autumn", "autumn", "autumn", "winter", "winter", "winter", "spring", "spring", "spring", "summer"] as const;
  return (lat >= 0 ? north : south)[month - 1];
}
