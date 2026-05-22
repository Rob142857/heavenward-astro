import type {
  AppContext,
  CelestialEvent,
  Equipment,
  TwilightTimes,
} from "../types.js";
import {
  getTwilightTimes,
  getPlanetEvents,
  getMoonEvent,
  getAltAzForRaDec,
  getRiseSetForRaDec,
  getSunAltitude,
} from "../engine/astro.js";
import { loadDSOCatalog } from "../catalog/dso.js";
import { loadStarCatalog } from "../catalog/stars.js";
import { METEOR_SHOWERS } from "../catalog/meteors.js";
import { renderHeader, renderNav } from "./layout.js";
import { navigate } from "./router.js";
import { trackEvent } from "../services/analytics.js";
import { savePrefs } from "../services/prefs.js";
import {
  CATEGORY_OPTIONS,
  DIRECTION_OPTIONS,
  EQUIPMENT_LIMITS,
  EQUIPMENT_OPTIONS,
  SORT_OPTIONS,
} from "./filterOptions.js";
import type { DirectionFilter, SortBy } from "../types.js";

const LIMIT_OPTIONS = [30, 50, 100, 0]; // 0 = all

/** Daytime peek: user chose to see objects despite sunlight (resets on reload) */
let daylightOverride = false;

/* ── Category filters ────────────────────────────────── */
const DSO_GALAXY_TYPES = new Set(["galaxy", "galaxy-pair", "galaxy-group"]);
const DSO_NEBULA_TYPES = new Set([
  "nebula",
  "planetary-nebula",
  "emission-nebula",
  "reflection-nebula",
  "dark-nebula",
  "supernova-remnant",
  "hii-region",
]);
const DSO_CLUSTER_TYPES = new Set([
  "cluster",
  "globular-cluster",
  "open-cluster",
]);

function eventCategory(ev: CelestialEvent): string {
  if (ev.type === "planet" || ev.type === "moon" || ev.type === "sun")
    return "solar-system";
  if (ev.type === "eclipse" || ev.type === "conjunction") return "solar-system";
  if (ev.type === "meteor-shower") return "milky-way";
  if (ev.type === "comet" || ev.type === "asteroid") return "solar-system";
  if (ev.type === "dso") {
    const ct = ev.extra.catalogType as string | undefined;
    // Stars from the star catalog have spectralType but no catalogType
    if (ev.extra.spectralType) {
      return "milky-way";
    }
    if (ct) {
      if (DSO_GALAXY_TYPES.has(ct)) return "beyond";
      if (DSO_NEBULA_TYPES.has(ct)) return "milky-way";
      if (DSO_CLUSTER_TYPES.has(ct)) return "milky-way";
    }
    return "beyond"; // Unclassified DSOs default to beyond the Milky Way
  }
  return "solar-system";
}

export function renderTonight(container: HTMLElement, ctx: AppContext): void {
  container.innerHTML = "";
  renderHeader(container, ctx);
  renderNav("#/");

  const now = new Date();
  const twilight = getTwilightTimes(ctx.location, now);

  renderTwilightBar(container, twilight);

  // Placeholder for cards while async data loads
  const cardsHolder = document.createElement("div");
  cardsHolder.className = "card-grid";
  for (let i = 0; i < 4; i++) {
    const skel = document.createElement("div");
    skel.className = "card skeleton skeleton-card";
    skel.style.setProperty("--i", String(i));
    cardsHolder.appendChild(skel);
  }
  container.appendChild(cardsHolder);

  // Collect all events (sync + async) then render together
  collectAllEvents(ctx, now).then((events) => {
    cardsHolder.remove();

    // Apply equipment mag filter + category filter
    const equipLimit = EQUIPMENT_LIMITS[ctx.prefs.equipment ?? "naked-eye"];
    const cats =
      ctx.prefs.enabledCategories ?? CATEGORY_OPTIONS.map((c) => c.key);
    const filtered = events.filter(
      (e) =>
        (e.magnitude === null || e.magnitude <= equipLimit) &&
        cats.includes(eventCategory(e)),
    );
    const directionFilter = ctx.prefs.directionFilter ?? [];
    const directional = filtered.filter((event) =>
      isInDirection(event, directionFilter),
    );

    const sortBy = ctx.prefs.sortBy ?? "brightest";
    const sortFn = getSortFn(sortBy, directionFilter);

    const visible = directional
      .filter((e) => (e.altitude ?? -1) > 0)
      .sort(sortFn);

    const below = directional
      .filter((e) => (e.altitude ?? -1) <= 0)
      .sort(sortFn);

    // Controls bar (equipment + limit)
    renderControls(container, ctx, directional.length, events.length, () => {
      // Re-render on filter change
      renderTonight(container, ctx);
    });

    // ── Daytime gate ───────────────────────────────────────────────
    const sunAlt = getSunAltitude(ctx.location, now);
    const isDaytime = sunAlt > 0;

    const limit = ctx.prefs.displayLimit ?? 50;
    let visibleRendered = 0;

    if (isDaytime && !daylightOverride) {
      // Sun is up — show friendly message instead of "Visible Now" cards
      const banner = document.createElement("div");
      banner.className = "daylight-banner";
      banner.innerHTML = `
        <div class="daylight-icon">☀️</div>
        <p class="daylight-msg">
          The Sun is ${sunAlt.toFixed(0)}° above the horizon — daylight is hiding everything else.
        </p>
        <p class="daylight-sub">
          ${visible.length} object${visible.length !== 1 ? "s" : ""} up there, lost in the glare.
        </p>
        <button class="daylight-peek">Peek anyway</button>
      `;
      banner.querySelector(".daylight-peek")!.addEventListener("click", () => {
        daylightOverride = true;
        renderTonight(container, ctx);
      });
      container.appendChild(banner);
    } else {
      const sectionLabel = isDaytime
        ? `Above Horizon (${visible.length}) — daytime peek`
        : `Visible Now (${visible.length})`;

      const section = document.createElement("h3");
      section.className = "section-title";
      section.textContent = sectionLabel;
      container.appendChild(section);

      const visibleSlice = limit > 0 ? visible.slice(0, limit) : visible;
      visibleRendered = visibleSlice.length;
      renderEventCards(container, visibleSlice, 0, ctx.location, now);

      const remaining = limit > 0 ? visible.length - limit : 0;
      if (remaining > 0) {
        renderShowMore(
          container,
          visible,
          visibleSlice.length,
          0,
          ctx.location,
          now,
        );
      }
    }

    if (below.length) {
      const belowSection = document.createElement("h3");
      belowSection.className = "section-title";
      belowSection.textContent = `Below Horizon (${below.length})`;
      container.appendChild(belowSection);

      const belowLimit =
        limit > 0 ? Math.max(0, limit - visible.length) : below.length;
      const belowSlice = belowLimit > 0 ? below.slice(0, belowLimit) : [];
      if (belowSlice.length > 0) {
        renderEventCards(
          container,
          belowSlice,
          visibleRendered,
          ctx.location,
          now,
        );
      }

      const belowRemaining = below.length - belowSlice.length;
      if (belowRemaining > 0) {
        renderShowMore(
          container,
          below,
          belowSlice.length,
          visibleRendered,
          ctx.location,
          now,
        );
      }
    }
  });
}

/* ── Sort comparators ────────────────────────────────── */
function getSortFn(
  sortBy: SortBy,
  directionFilter: DirectionFilter,
): (a: CelestialEvent, b: CelestialEvent) => number {
  switch (sortBy) {
    case "brightest":
      return compareBrightest;
    case "closest":
      return compareClosest;
    case "farthest":
      return compareFarthest;
    case "direction":
      return (a, b) => compareDirection(a, b, directionFilter);
  }
}

const AU_PER_LIGHT_YEAR = 63241.077;

function compareBrightest(a: CelestialEvent, b: CelestialEvent): number {
  return (a.magnitude ?? 99) - (b.magnitude ?? 99) || compareNames(a, b);
}

function compareClosest(a: CelestialEvent, b: CelestialEvent): number {
  const aDistance = getDistanceLY(a);
  const bDistance = getDistanceLY(b);
  if (aDistance === null && bDistance === null) return compareBrightest(a, b);
  if (aDistance === null) return 1;
  if (bDistance === null) return -1;
  return aDistance - bDistance || compareBrightest(a, b);
}

function compareFarthest(a: CelestialEvent, b: CelestialEvent): number {
  const aDistance = getDistanceLY(a);
  const bDistance = getDistanceLY(b);
  if (aDistance === null && bDistance === null) return compareBrightest(a, b);
  if (aDistance === null) return 1;
  if (bDistance === null) return -1;
  return bDistance - aDistance || compareBrightest(a, b);
}

function compareDirection(
  a: CelestialEvent,
  b: CelestialEvent,
  directionFilter: DirectionFilter,
): number {
  // With one or more cardinals selected (but not all four), sort by distance
  // to the centroid of the selected union arc — nearest first.
  if (directionFilter.length > 0 && directionFilter.length < 4) {
    const center = directionCentroid(directionFilter);
    return (
      azimuthDistance(a.azimuth, center) - azimuthDistance(b.azimuth, center) ||
      (b.altitude ?? -90) - (a.altitude ?? -90) ||
      compareNames(a, b)
    );
  }

  return (
    normalizeAzimuth(a.azimuth) - normalizeAzimuth(b.azimuth) ||
    (b.altitude ?? -90) - (a.altitude ?? -90) ||
    compareNames(a, b)
  );
}

function compareNames(a: CelestialEvent, b: CelestialEvent): number {
  return a.name.localeCompare(b.name);
}

function getDistanceLY(event: CelestialEvent): number | null {
  const extraDistanceLY = event.extra.distanceLY;
  if (typeof extraDistanceLY === "number" && Number.isFinite(extraDistanceLY)) {
    return extraDistanceLY;
  }

  const extraDistancePC = event.extra.distancePC;
  if (typeof extraDistancePC === "number" && Number.isFinite(extraDistancePC)) {
    return extraDistancePC * 3.26156;
  }

  if (event.distanceAU !== null && Number.isFinite(event.distanceAU)) {
    return event.distanceAU / AU_PER_LIGHT_YEAR;
  }

  return null;
}

function isInDirection(
  event: CelestialEvent,
  directionFilter: DirectionFilter,
): boolean {
  // Empty filter ≡ all four cardinals ≡ no restriction.
  if (directionFilter.length === 0) return true;
  const azimuth = normalizeAzimuth(event.azimuth);
  if (azimuth >= 360) return false;

  for (const cardinal of directionFilter) {
    switch (cardinal) {
      case "north":
        if (azimuth >= 315 || azimuth < 45) return true;
        break;
      case "east":
        if (azimuth >= 45 && azimuth < 135) return true;
        break;
      case "south":
        if (azimuth >= 135 && azimuth < 225) return true;
        break;
      case "west":
        if (azimuth >= 225 && azimuth < 315) return true;
        break;
    }
  }
  return false;
}

function normalizeAzimuth(azimuth: number | null): number {
  if (azimuth === null || !Number.isFinite(azimuth)) return 999;
  return ((azimuth % 360) + 360) % 360;
}

function azimuthDistance(azimuth: number | null, center: number): number {
  const normalized = normalizeAzimuth(azimuth);
  if (normalized >= 360) return 999;
  const difference = Math.abs(normalized - center);
  return Math.min(difference, 360 - difference);
}

function directionCentroid(directionFilter: DirectionFilter): number {
  // Each cardinal's centre azimuth, summed as 2-D unit vectors so wrap-around
  // (N ~ 0\u00b0/360\u00b0) is handled correctly. Returns the bearing of the resultant.
  const centres: Record<"north" | "east" | "south" | "west", number> = {
    north: 0,
    east: 90,
    south: 180,
    west: 270,
  };
  let x = 0;
  let y = 0;
  for (const c of directionFilter) {
    const rad = (centres[c] * Math.PI) / 180;
    x += Math.sin(rad);
    y += Math.cos(rad);
  }
  if (x === 0 && y === 0) return 0;
  const deg = (Math.atan2(x, y) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

/* ── Controls bar: equipment + categories + sort + limit ── */
function renderControls(
  container: HTMLElement,
  ctx: AppContext,
  filteredCount: number,
  totalCount: number,
  onChange: () => void,
): void {
  const bar = document.createElement("div");
  bar.className = "tonight-controls";

  // Row 1: equipment + category pills
  const pillRow = document.createElement("div");
  pillRow.className = "ctrl-pill-row";

  for (const eq of EQUIPMENT_OPTIONS) {
    const pill = document.createElement("button");
    pill.className = `ctrl-pill eq-pill${(ctx.prefs.equipment ?? "naked-eye") === eq.key ? " active" : ""}`;
    pill.setAttribute("title", eq.label);
    pill.innerHTML = `<span class="eq-icon">${eq.icon}</span><span class="eq-text">${eq.label}</span>`;
    pill.addEventListener("click", () => {
      ctx.prefs.equipment = eq.key;
      ctx.prefs.magnitudeLimit = EQUIPMENT_LIMITS[eq.key];
      savePrefs(ctx.prefs);
      onChange();
    });
    pillRow.appendChild(pill);
  }

  const cats =
    ctx.prefs.enabledCategories ?? CATEGORY_OPTIONS.map((c) => c.key);
  for (const cat of CATEGORY_OPTIONS) {
    const pill = document.createElement("button");
    pill.className = `ctrl-pill cat-pill${cats.includes(cat.key) ? " active" : ""}`;
    pill.setAttribute("title", cat.label);
    pill.innerHTML = `<span class="eq-icon">${cat.icon}</span><span class="eq-text">${cat.label}</span>`;
    pill.addEventListener("click", () => {
      const cur =
        ctx.prefs.enabledCategories ?? CATEGORY_OPTIONS.map((c) => c.key);
      if (cur.includes(cat.key)) {
        ctx.prefs.enabledCategories = cur.filter((k) => k !== cat.key);
      } else {
        ctx.prefs.enabledCategories = [...cur, cat.key];
      }
      savePrefs(ctx.prefs);
      onChange();
    });
    pillRow.appendChild(pill);
  }
  bar.appendChild(pillRow);

  // Row 2: sort \u00b7 direction pills \u00b7 limit
  const metaRow = document.createElement("div");
  metaRow.className = "ctrl-meta-row";

  // Sort select (no label \u2014 selected value speaks for itself)
  const sortSel = document.createElement("select");
  sortSel.className = "ctrl-select";
  sortSel.setAttribute("aria-label", "Sort by");
  sortSel.title = "Sort";
  for (const s of SORT_OPTIONS) {
    const opt = document.createElement("option");
    opt.value = s.key;
    opt.textContent = s.label;
    if ((ctx.prefs.sortBy ?? "brightest") === s.key) opt.selected = true;
    sortSel.appendChild(opt);
  }
  sortSel.addEventListener("change", () => {
    ctx.prefs.sortBy = sortSel.value as SortBy;
    savePrefs(ctx.prefs);
    onChange();
  });
  metaRow.appendChild(sortSel);

  // Direction multi-select pills. Empty selection = all (no filter).
  const directionPills = document.createElement("div");
  directionPills.className = "direction-pills";
  directionPills.setAttribute("role", "group");
  directionPills.setAttribute("aria-label", "Direction filter");
  const active = new Set(ctx.prefs.directionFilter ?? []);
  for (const direction of DIRECTION_OPTIONS) {
    const pill = document.createElement("button");
    pill.className = `direction-pill${active.has(direction.key) ? " active" : ""}`;
    pill.type = "button";
    pill.textContent = direction.shortLabel;
    pill.title = `${direction.label} quadrant \u2014 tap to combine`;
    pill.setAttribute("aria-label", direction.label);
    pill.setAttribute("aria-pressed", active.has(direction.key) ? "true" : "false");
    pill.addEventListener("click", () => {
      const next = new Set(ctx.prefs.directionFilter ?? []);
      if (next.has(direction.key)) next.delete(direction.key);
      else next.add(direction.key);
      // All four \u2261 none (both mean \"everywhere\") \u2014 normalise to empty.
      ctx.prefs.directionFilter = next.size === 4 ? [] : Array.from(next);
      savePrefs(ctx.prefs);
      onChange();
    });
    directionPills.appendChild(pill);
  }
  metaRow.appendChild(directionPills);

  // Show-limit select \u2014 trailing count badge replaces \"Show\" label.
  const limitSel = document.createElement("select");
  limitSel.className = "ctrl-select";
  limitSel.setAttribute("aria-label", "Maximum results");
  limitSel.title = "Show";
  for (const n of LIMIT_OPTIONS) {
    const opt = document.createElement("option");
    opt.value = String(n);
    opt.textContent = n === 0 ? "All" : String(n);
    if ((ctx.prefs.displayLimit ?? 50) === n) opt.selected = true;
    limitSel.appendChild(opt);
  }
  limitSel.addEventListener("change", () => {
    ctx.prefs.displayLimit = Number(limitSel.value);
    savePrefs(ctx.prefs);
    onChange();
  });
  metaRow.appendChild(limitSel);

  const countBadge = document.createElement("span");
  countBadge.className = "ctrl-count";
  countBadge.textContent =
    filteredCount < totalCount
      ? `${filteredCount}/${totalCount}`
      : `${totalCount}`;
  countBadge.title = `${filteredCount} of ${totalCount} after filters`;
  metaRow.appendChild(countBadge);

  bar.appendChild(metaRow);
  container.appendChild(bar);
}

/* ── "Show more" button ──────────────────────────────── */
function renderShowMore(
  container: HTMLElement,
  allEvents: CelestialEvent[],
  alreadyShown: number,
  indexOffset: number,
  loc?: { lat: number; lon: number; elev: number },
  now?: Date,
): void {
  const remaining = allEvents.length - alreadyShown;
  const btn = document.createElement("button");
  btn.className = "btn btn-ghost show-more-btn";
  btn.textContent = `Show ${remaining} more`;
  btn.addEventListener("click", () => {
    btn.remove();
    const grid = document.createElement("div");
    grid.className = "card-grid";
    const t = now ?? new Date();
    for (let i = alreadyShown; i < allEvents.length; i++) {
      const ev = allEvents[i];
      if (loc) ensureRiseSet(ev, loc, t);
      grid.appendChild(buildCard(ev, indexOffset + i));
    }
    container.appendChild(grid);
  });
  container.appendChild(btn);
}

async function collectAllEvents(
  ctx: AppContext,
  now: Date,
): Promise<CelestialEvent[]> {
  const events: CelestialEvent[] = [];

  if (ctx.prefs.enabledSources.includes("moon")) {
    events.push(getMoonEvent(ctx.location, now));
  }
  if (ctx.prefs.enabledSources.includes("planets")) {
    events.push(...getPlanetEvents(ctx.location, now));
  }

  // Meteors (sync)
  if (ctx.prefs.enabledSources.includes("meteors")) {
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const active = METEOR_SHOWERS.filter((s) => isShowerActive(s, month, day));
    const meteorEvents = active.map((s): CelestialEvent => {
      const hor = getAltAzForRaDec(
        s.radiantRA,
        s.radiantDec,
        ctx.location,
        now,
      );
      const rs = getRiseSetForRaDec(
        s.radiantRA,
        s.radiantDec,
        ctx.location,
        now,
      );
      return {
        id: `meteor-${s.id}`,
        name: s.name,
        type: "meteor-shower",
        source: "catalog",
        brief: `ZHR ${s.zhr} · ${s.speed} km/s · Parent: ${s.parentBody}`,
        rise: rs.rise,
        set: rs.set,
        transit: rs.transit,
        altitude: hor.altitude,
        azimuth: hor.azimuth,
        magnitude: null,
        constellation: null,
        illumination: null,
        ra: s.radiantRA,
        dec: s.radiantDec,
        angularSize: null,
        distanceAU: null,
        extra: {
          sourceKey: "meteors",
          zhr: s.zhr,
          speed: s.speed,
          parentBody: s.parentBody,
        },
      };
    });
    events.push(...meteorEvents);
  }

  // DSOs + Stars (async, in parallel)
  const promises: Promise<CelestialEvent[]>[] = [];

  if (ctx.prefs.enabledSources.includes("dso")) {
    promises.push(
      loadDSOCatalog().then((dsos) =>
        dsos
          .filter((d) => d.magnitude <= ctx.prefs.magnitudeLimit)
          .map((d): CelestialEvent => {
            const hor = getAltAzForRaDec(d.ra, d.dec, ctx.location, now);
            // Rise/set is expensive (~432 horizon calls each). Defer until
            // the event is actually rendered as a card.
            return {
              id: `dso-${d.id}`,
              name: d.commonName || d.name,
              type: "dso",
              source: "catalog",
              brief: `${d.type} · Mag ${d.magnitude.toFixed(1)} in ${d.constellation}`,
              rise: null,
              set: null,
              transit: null,
              altitude: hor.altitude,
              azimuth: hor.azimuth,
              magnitude: d.magnitude,
              constellation: d.constellation,
              illumination: null,
              ra: d.ra,
              dec: d.dec,
              angularSize: d.size,
              distanceAU: null,
              extra: {
                sourceKey: "dso",
                catalogType: d.type,
                size: d.size,
                distanceLY: d.distanceLY,
                distancePC: d.distancePC,
              },
            };
          }),
      ),
    );
  }

  if (ctx.prefs.enabledSources.includes("stars")) {
    promises.push(
      loadStarCatalog().then((stars) =>
        stars
          .filter((s) => s.magnitude <= ctx.prefs.magnitudeLimit)
          .map((s): CelestialEvent => {
            const hor = getAltAzForRaDec(s.ra, s.dec, ctx.location, now);
            return {
              id: `star-${s.id}`,
              name: s.name,
              type: "dso",
              source: "catalog",
              brief: `${s.spectralType} · Mag ${s.magnitude.toFixed(2)} in ${s.constellation}${s.isDouble ? " · Double" : ""}${s.isVariable ? " · Variable" : ""}`,
              rise: null,
              set: null,
              transit: null,
              altitude: hor.altitude,
              azimuth: hor.azimuth,
              magnitude: s.magnitude,
              constellation: s.constellation,
              illumination: null,
              ra: s.ra,
              dec: s.dec,
              angularSize: null,
              distanceAU: null,
              extra: {
                sourceKey: "stars",
                spectralType: s.spectralType,
                isDouble: s.isDouble,
                isVariable: s.isVariable,
                distanceLY: s.distanceLY,
                distancePC: s.distancePC,
              },
            };
          }),
      ),
    );
  }

  const results = await Promise.all(promises);
  for (const batch of results) {
    events.push(...batch);
  }

  return events;
}

function renderTwilightBar(container: HTMLElement, tw: TwilightTimes): void {
  const bar = document.createElement("div");
  bar.className = "twilight-bar compact";
  bar.innerHTML = `
    <div class="twilight-summary">
      <div class="twilight-visual"></div>
      <div class="twilight-quick">
        <span>☀↓ ${fmt(tw.sunset)}</span>
        <span class="tw-sep">·</span>
        <span>🌑 ${tw.nightDurationHours.toFixed(1)}h</span>
        <span class="tw-sep">·</span>
        <span>☀↑ ${fmt(tw.sunrise)}</span>
      </div>
      <button class="twilight-toggle" aria-label="Show details" aria-expanded="false">▾</button>
    </div>
    <div class="twilight-details">
      <div class="twilight-grid">
        <span class="label">Sunset</span><span class="time">${fmt(tw.sunset)}</span>
        <span class="label">Civil dusk</span><span class="time">${fmt(tw.civilDusk)}</span>
        <span class="label">Nautical dusk</span><span class="time">${fmt(tw.nauticalDusk)}</span>
        <span class="label">Astro dusk</span><span class="time">${fmt(tw.astronomicalDusk)}</span>
        <span class="label">Astro dawn</span><span class="time">${fmt(tw.astronomicalDawn)}</span>
        <span class="label">Nautical dawn</span><span class="time">${fmt(tw.nauticalDawn)}</span>
        <span class="label">Civil dawn</span><span class="time">${fmt(tw.civilDawn)}</span>
        <span class="label">Sunrise</span><span class="time">${fmt(tw.sunrise)}</span>
      </div>
    </div>
  `;
  const toggle = bar.querySelector(".twilight-toggle")!;
  toggle.addEventListener("click", () => {
    const expanded = bar.classList.toggle("expanded");
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.textContent = expanded ? "▴" : "▾";
  });
  container.appendChild(bar);
}

/* ── Card builder (shared by renderEventCards + showMore) */

// Lazy rise/set cache: catalog items skip the expensive rise/set search
// in collectAllEvents and only compute it for cards that actually render.
// Keyed by (id|day) so the result is shared across rerenders within the
// same evening.
const riseSetCache = new Map<
  string,
  { rise: Date | null; set: Date | null; transit: Date | null }
>();

function ensureRiseSet(
  ev: CelestialEvent,
  loc: { lat: number; lon: number; elev: number },
  now: Date,
): void {
  if (ev.rise !== null || ev.set !== null) return;
  if (ev.ra === null || ev.dec === null) return;
  const dayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  const key = `${ev.id}|${dayKey}`;
  let rs = riseSetCache.get(key);
  if (!rs) {
    rs = getRiseSetForRaDec(ev.ra, ev.dec, loc, now);
    riseSetCache.set(key, rs);
  }
  ev.rise = rs.rise;
  ev.set = rs.set;
  ev.transit = rs.transit;
}

function buildCard(ev: CelestialEvent, index: number): HTMLElement {
  const isUp = (ev.altitude ?? -1) > 0;
  const card = document.createElement("div");
  card.className = `card card-type-${ev.type}`;
  card.style.setProperty("--i", String(index));
  card.addEventListener("click", () => {
    trackEvent("click", `#/detail/${ev.id}`, ev.name);
    navigate(`#/detail/${ev.id}`);
  });
  card.innerHTML = `
    <div class="card-header">
      <span class="card-title"><span class="vis-dot ${isUp ? "up" : "down"}"></span>${ev.name}</span>
      ${ev.magnitude !== null ? `<span class="card-mag">mag ${ev.magnitude.toFixed(1)}</span>` : ""}
    </div>
    <div class="card-brief">${ev.brief}</div>
    <div class="card-times">
      ${ev.altitude !== null ? `<span>Alt ${ev.altitude.toFixed(1)}°</span>` : ""}
      ${ev.azimuth !== null ? `<span>Az ${ev.azimuth.toFixed(0)}°</span>` : ""}
      ${ev.rise ? `<span>↑${fmtShort(ev.rise)}</span>` : ""}
      ${ev.set ? `<span>↓${fmtShort(ev.set)}</span>` : ""}
    </div>
  `;
  return card;
}

function renderEventCards(
  container: HTMLElement,
  events: CelestialEvent[],
  startIndex = 0,
  loc?: { lat: number; lon: number; elev: number },
  now?: Date,
): void {
  const grid = document.createElement("div");
  grid.className = "card-grid";
  const t = now ?? new Date();
  for (let i = 0; i < events.length; i++) {
    if (loc) ensureRiseSet(events[i], loc, t);
    grid.appendChild(buildCard(events[i], startIndex + i));
  }
  container.appendChild(grid);
}

function fmt(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtShort(d: Date): string {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
  return now >= start || now <= end; // wraps year boundary
}
