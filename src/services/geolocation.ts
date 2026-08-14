import type { GeoLocation } from "../types.js";

const STORAGE_KEY = "heavenward-location";

/**
 * Whether the location currently in use is actually the user's, or the
 * Greenwich fallback we start from before GPS answers.
 *
 * This matters more than it looks. The fallback is at +51° — northern
 * hemisphere — so a user in Australia whose GPS is denied, blocked or slow
 * silently gets the entire wrong sky: wrong objects, wrong directions,
 * Polaris visible and Crux absent. Previously that only reached a
 * console.log, so the app's whole purpose could fail without ever saying so.
 */
let locationIsConfirmed = false;
// Increments for every accepted GPS or manual save. A GPS request captures
// the revision it started at; if the user saves a manual location while that
// request is pending, the late GPS callback must not silently overwrite it.
let locationRevision = 0;

export function isLocationConfirmed(): boolean {
  return locationIsConfirmed;
}

/** Marks the location as genuinely the user's — GPS fix or manual entry. */
export function markLocationConfirmed(): void {
  locationIsConfirmed = true;
}

export function getSavedLocation(): GeoLocation | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (isGeoLocation(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}

export function saveLocation(loc: GeoLocation): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(loc));
  locationRevision += 1;
  // Anything we persist came from GPS or the user typing it in; either way
  // it is a real place and not the fallback.
  markLocationConfirmed();
}

export function requestGPS(): Promise<GeoLocation> {
  const revisionAtRequest = locationRevision;
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation not supported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc: GeoLocation = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          elev: pos.coords.altitude ?? 0,
        };
        if (locationRevision !== revisionAtRequest) {
          // Another accepted choice won while the browser was locating. In
          // practice this is usually the manual form, and explicit input must
          // outrank an older background request.
          resolve(getSavedLocation() ?? loc);
          return;
        }
        saveLocation(loc);
        resolve(loc);
      },
      (err) => reject(new Error(err.message)),
      { enableHighAccuracy: false, timeout: 10_000 },
    );
  });
}

function isGeoLocation(v: unknown): v is GeoLocation {
  return (
    typeof v === "object" &&
    v !== null &&
    "lat" in v &&
    typeof (v as Record<string, unknown>).lat === "number" &&
    "lon" in v &&
    typeof (v as Record<string, unknown>).lon === "number" &&
    "elev" in v &&
    typeof (v as Record<string, unknown>).elev === "number"
  );
}
