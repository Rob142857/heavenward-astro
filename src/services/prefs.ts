import type { UserPrefs } from '../types.js';

const PREFS_KEY = 'heavenward-prefs';

const DEFAULT_PREFS: UserPrefs = {
  enabledSources: ['planets', 'moon', 'dso', 'meteors', 'eclipses', 'conjunctions'],
  magnitudeLimit: 6.0,
  defaultLocation: null,
};

export function loadPrefs(): UserPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && 'enabledSources' in parsed) {
      return parsed as UserPrefs;
    }
    return { ...DEFAULT_PREFS };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: UserPrefs): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}
