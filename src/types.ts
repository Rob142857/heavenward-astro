export interface GeoLocation {
  lat: number;
  lon: number;
  elev: number;
}

export interface CelestialEvent {
  id: string;
  name: string;
  type: 'planet' | 'moon' | 'sun' | 'dso' | 'meteor-shower' | 'satellite' | 'asteroid' | 'comet' | 'eclipse' | 'conjunction';
  source: string;
  brief: string;
  rise: Date | null;
  set: Date | null;
  transit: Date | null;
  altitude: number | null;
  azimuth: number | null;
  magnitude: number | null;
  constellation: string | null;
  illumination: number | null;
  ra: number | null;
  dec: number | null;
  angularSize: number | null;
  distanceAU: number | null;
  extra: Record<string, unknown>;
}

export interface TwilightTimes {
  sunset: Date | null;
  civilDusk: Date | null;
  nauticalDusk: Date | null;
  astronomicalDusk: Date | null;
  astronomicalDawn: Date | null;
  nauticalDawn: Date | null;
  civilDawn: Date | null;
  sunrise: Date | null;
  nightDurationHours: number;
}

export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  provider: 'google' | 'microsoft';
}

export interface UserPrefs {
  enabledSources: string[];
  magnitudeLimit: number;
  defaultLocation: GeoLocation | null;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
}

export interface AppContext {
  location: GeoLocation;
  prefs: UserPrefs;
  user: UserProfile | null;
}
