import type { GeoLocation } from '../types.js';

const STORAGE_KEY = 'heavenward-location';

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
}

export function requestGPS(): Promise<GeoLocation> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc: GeoLocation = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          elev: pos.coords.altitude ?? 0,
        };
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
    typeof v === 'object' && v !== null &&
    'lat' in v && typeof (v as Record<string, unknown>).lat === 'number' &&
    'lon' in v && typeof (v as Record<string, unknown>).lon === 'number' &&
    'elev' in v && typeof (v as Record<string, unknown>).elev === 'number'
  );
}
