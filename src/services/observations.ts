import type { GeoLocation } from "../types.js";

// ── Types ─────────────────────────────────────────────────────────

export interface ObservationEntry {
  /** Object id within Heavenward (e.g. "dso-m31", "star-vega", "moon"). */
  id: string;
  /** Display name at the moment of viewing. */
  name: string;
  /** "dso" | "star" | "planet" | "moon" | "sun" | "meteor-shower" | ... */
  type: string;
  /** Short brief shown on the detail card (optional, helps the export read well). */
  brief?: string;
  /** ISO timestamp when this object was first opened in this session. */
  firstViewedAt: string;
  /** ISO timestamp of the most recent viewing. */
  lastViewedAt: string;
  /** Times opened during this session. */
  views: number;
}

export interface ObservationSession {
  id: string;
  startedAt: string;
  endedAt: string;
  entries: ObservationEntry[];
  /** Coarse region label (e.g. "Sydney, Australia"). Never raw coordinates. */
  region: string | null;
  /** Lat/lon rounded to ~0.1° (~11 km) — coarse, not GPS-precise. */
  latCoarse: number | null;
  lonCoarse: number | null;
  /** Exact location kept only on the device until export. */
  exactLocation: GeoLocation | null;
}

export interface SavedObservationSummary {
  id: string;
  startedAt: string;
  endedAt: string;
  region: string | null;
  entryCount: number;
  entries: ObservationEntry[];
}

// ── Constants ─────────────────────────────────────────────────────

const STORAGE_KEY = "heavenward-observations-session";
/** Sessions are bounded by an overnight gap — if inactive ≥6 h, start fresh. */
const SESSION_GAP_MS = 6 * 60 * 60 * 1000;
const REGION_CACHE_KEY = "heavenward-region-cache";
const SHARE_BASE = "https://sky.incitat.io/#/detail/";

// ── Session state ─────────────────────────────────────────────────

let cached: ObservationSession | null = null;

function load(): ObservationSession | null {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ObservationSession;
    if (!parsed || !Array.isArray(parsed.entries)) return null;
    cached = parsed;
    return cached;
  } catch {
    return null;
  }
}

function persist(session: ObservationSession): void {
  cached = session;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* ignore quota errors */
  }
}

function freshSession(loc: GeoLocation | null): ObservationSession {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    startedAt: now,
    endedAt: now,
    entries: [],
    region: null,
    latCoarse: loc ? round1(loc.lat) : null,
    lonCoarse: loc ? round1(loc.lon) : null,
    exactLocation: loc,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ── Recording ─────────────────────────────────────────────────────

export function recordObservation(input: {
  id: string;
  name: string;
  type: string;
  brief?: string;
  location: GeoLocation | null;
}): void {
  if (!input.id) return;
  const nowIso = new Date().toISOString();
  let session = load();

  if (session) {
    const last = Date.parse(session.endedAt);
    if (!Number.isNaN(last) && Date.now() - last > SESSION_GAP_MS) {
      session = freshSession(input.location);
    }
  } else {
    session = freshSession(input.location);
  }

  // Keep coarse location in sync with current GPS, if changed.
  if (input.location) {
    session.exactLocation = input.location;
    session.latCoarse = round1(input.location.lat);
    session.lonCoarse = round1(input.location.lon);
  }

  const existing = session.entries.find((e) => e.id === input.id);
  if (existing) {
    existing.lastViewedAt = nowIso;
    existing.views += 1;
    if (input.brief && !existing.brief) existing.brief = input.brief;
    if (input.name) existing.name = input.name;
  } else {
    session.entries.push({
      id: input.id,
      name: input.name,
      type: input.type,
      brief: input.brief,
      firstViewedAt: nowIso,
      lastViewedAt: nowIso,
      views: 1,
    });
  }

  session.endedAt = nowIso;
  persist(session);

  // Best-effort region resolution (async, no await).
  if (input.location && !session.region) {
    resolveRegion(input.location)
      .then((label) => {
        if (!label) return;
        const cur = load();
        if (!cur || cur.id !== session!.id) return;
        cur.region = label;
        persist(cur);
      })
      .catch(() => {});
  }
}

export function getCurrentSession(): ObservationSession | null {
  return load();
}

export function clearCurrentSession(): void {
  cached = null;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// ── Coarse region lookup (free, no API key) ──────────────────────

interface RegionCache {
  [key: string]: { label: string; ts: number };
}

function loadRegionCache(): RegionCache {
  try {
    const raw = localStorage.getItem(REGION_CACHE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as RegionCache;
  } catch {
    return {};
  }
}

function saveRegionCache(cache: RegionCache): void {
  try {
    localStorage.setItem(REGION_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* ignore */
  }
}

async function resolveRegion(loc: GeoLocation): Promise<string | null> {
  // Coarsen BEFORE the request, not just for the cache key. This is the only
  // point in the app where a user's coordinates leave the device, and the
  // recipient's privacy policy does not say what it does with them, so the
  // precision is reduced to ~11 km rather than trusted away. That is ample to
  // name a town and far too coarse to place a home, and it matches the
  // precision observations are already stored at (latCoarse/lonCoarse above),
  // so the cache key and the request now describe the same place.
  const lat = round1(loc.lat);
  const lon = round1(loc.lon);
  const key = `${lat},${lon}`;
  const cache = loadRegionCache();
  const hit = cache[key];
  if (hit && Date.now() - hit.ts < 30 * 24 * 60 * 60 * 1000) {
    return hit.label;
  }
  try {
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      city?: string;
      locality?: string;
      principalSubdivision?: string;
      countryName?: string;
    };
    const place = data.city || data.locality || data.principalSubdivision;
    const country = data.countryName;
    const label = [place, country].filter(Boolean).join(", ") || null;
    if (label) {
      cache[key] = { label, ts: Date.now() };
      saveRegionCache(cache);
    }
    return label;
  } catch {
    return null;
  }
}

// ── Export formatting ─────────────────────────────────────────────

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatLocation(
  session: ObservationSession,
  opts: { includeExactGps: boolean },
): string {
  if (opts.includeExactGps && session.exactLocation) {
    const { lat, lon, elev } = session.exactLocation;
    const latStr = `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? "N" : "S"}`;
    const lonStr = `${Math.abs(lon).toFixed(4)}°${lon >= 0 ? "E" : "W"}`;
    const elevStr = elev ? `, ${elev.toFixed(0)} m` : "";
    const region = session.region ? `${session.region} — ` : "";
    return `${region}${latStr}, ${lonStr}${elevStr}`;
  }
  if (session.region) return session.region;
  if (session.latCoarse !== null && session.lonCoarse !== null) {
    const latStr = `${Math.abs(session.latCoarse).toFixed(1)}°${session.latCoarse >= 0 ? "N" : "S"}`;
    const lonStr = `${Math.abs(session.lonCoarse).toFixed(1)}°${session.lonCoarse >= 0 ? "E" : "W"}`;
    return `near ${latStr}, ${lonStr}`;
  }
  return "Location unknown";
}

export interface ExportOptions {
  includeExactGps: boolean;
  notes?: string;
}

export function exportSessionMarkdown(
  session: ObservationSession,
  opts: ExportOptions,
): string {
  const lines: string[] = [];
  lines.push(`# Observing notes — ${fmtDate(session.startedAt)}`);
  lines.push("");
  lines.push(`Location: ${formatLocation(session, opts)}`);
  lines.push(
    `From ${fmtTime(session.startedAt)} to ${fmtTime(session.endedAt)}`,
  );
  lines.push("");

  if (session.entries.length === 0) {
    lines.push("_No objects visited this session yet._");
  } else {
    lines.push(`## Objects (${session.entries.length})`);
    lines.push("");
    // Chronological order so the notes read like a diary.
    const ordered = [...session.entries].sort((a, b) =>
      a.firstViewedAt.localeCompare(b.firstViewedAt),
    );
    for (const e of ordered) {
      const url = `${SHARE_BASE}${e.id}`;
      const repeat = e.views > 1 ? ` (viewed ×${e.views})` : "";
      lines.push(
        `- **${fmtTime(e.firstViewedAt)}** — [${e.name}](${url})${repeat}`,
      );
      if (e.brief) lines.push(`    ${e.brief}`);
    }
  }

  if (opts.notes && opts.notes.trim()) {
    lines.push("");
    lines.push("## Notes");
    lines.push("");
    lines.push(opts.notes.trim());
  }

  lines.push("");
  lines.push("_Recorded with Heavenward — sky.incitat.io_");
  return lines.join("\n");
}

// ── Server sync (signed-in users) ────────────────────────────────

export async function saveSessionToAccount(
  session: ObservationSession,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const res = await fetch("/api/observations", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: session.id,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        region: session.region,
        latCoarse: session.latCoarse,
        lonCoarse: session.lonCoarse,
        entries: session.entries,
      }),
    });
    const data = (await res.json()) as {
      ok: boolean;
      data?: { id: string };
      error?: string;
    };
    if (!data.ok) return { ok: false, error: data.error };
    return { ok: true, id: data.data?.id ?? session.id };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function fetchObservationHistory(): Promise<
  SavedObservationSummary[]
> {
  try {
    const res = await fetch("/api/observations", {
      credentials: "same-origin",
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      ok: boolean;
      data?: SavedObservationSummary[];
    };
    return data.ok && Array.isArray(data.data) ? data.data : [];
  } catch {
    return [];
  }
}

export async function deleteObservation(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/observations/${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    const data = (await res.json()) as { ok: boolean };
    return data.ok;
  } catch {
    return false;
  }
}
