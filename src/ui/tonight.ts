import type { AppContext, CelestialEvent, Equipment, TwilightTimes } from "../types.js";
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
import { CATEGORY_OPTIONS, EQUIPMENT_LIMITS, EQUIPMENT_OPTIONS, SORT_OPTIONS } from "./filterOptions.js";
import type { SortBy } from "../types.js";

const LIMIT_OPTIONS = [30, 50, 100, 0]; // 0 = all

/** Daytime peek: user chose to see objects despite sunlight (resets on reload) */
let daylightOverride = false;

/* ── Category filters ────────────────────────────────── */
const DSO_GALAXY_TYPES = new Set(["galaxy", "galaxy-pair", "galaxy-group"]);
const DSO_NEBULA_TYPES = new Set([
  "nebula", "planetary-nebula", "emission-nebula", "reflection-nebula",
  "dark-nebula", "supernova-remnant", "hii-region",
]);
const DSO_CLUSTER_TYPES = new Set(["cluster", "globular-cluster", "open-cluster"]);

function eventCategory(ev: CelestialEvent): string {
  if (ev.type === "planet" || ev.type === "moon" || ev.type === "sun") return "solar-system";
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
    const cats = ctx.prefs.enabledCategories ?? CATEGORY_OPTIONS.map((c) => c.key);
    const filtered = events.filter(
      (e) =>
        (e.magnitude === null || e.magnitude <= equipLimit) &&
        cats.includes(eventCategory(e)),
    );

    const sortBy = ctx.prefs.sortBy ?? "brightest";
    const sortFn = getSortFn(sortBy);

    const visible = filtered
      .filter((e) => (e.altitude ?? -1) > 0)
      .sort(sortFn);

    const below = filtered
      .filter((e) => (e.altitude ?? -1) <= 0)
      .sort(sortFn);

    // Controls bar (equipment + limit)
    renderControls(container, ctx, filtered.length, events.length, () => {
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
          The Sun is ${sunAlt.toFixed(0)}° above the horizon right now.
          Unless you have a radio telescope, atmospheric light is making
          the sky's treasures invisible!
        </p>
        <p class="daylight-sub">
          ${visible.length} object${visible.length !== 1 ? "s" : ""} above the horizon,
          hidden behind the Sun's rays.
        </p>
        <button class="daylight-peek">Peek behind the sunlight</button>
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
      renderEventCards(container, visibleSlice, 0);

      const remaining = limit > 0 ? visible.length - limit : 0;
      if (remaining > 0) {
        renderShowMore(container, visible, visibleSlice.length, 0);
      }
    }

    if (below.length) {
      const belowSection = document.createElement("h3");
      belowSection.className = "section-title";
      belowSection.textContent = `Below Horizon (${below.length})`;
      container.appendChild(belowSection);

      const belowLimit = limit > 0 ? Math.max(0, limit - visible.length) : below.length;
      const belowSlice = belowLimit > 0 ? below.slice(0, belowLimit) : [];
      if (belowSlice.length > 0) {
        renderEventCards(container, belowSlice, visibleRendered);
      }

      const belowRemaining = below.length - belowSlice.length;
      if (belowRemaining > 0) {
        renderShowMore(container, below, belowSlice.length, visibleRendered);
      }
    }
  });
}

/* ── Sort comparators ────────────────────────────────── */
function getSortFn(sortBy: SortBy): (a: CelestialEvent, b: CelestialEvent) => number {
  switch (sortBy) {
    case "brightest":
      return (a, b) => (a.magnitude ?? 99) - (b.magnitude ?? 99);
    case "highest":
      return (a, b) => (b.altitude ?? -90) - (a.altitude ?? -90);
    case "lowest":
      return (a, b) => (a.altitude ?? -90) - (b.altitude ?? -90);
    case "smallest":
      return (a, b) => (a.angularSize ?? 9999) - (b.angularSize ?? 9999);
  }
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

  const divider = document.createElement("span");
  divider.className = "ctrl-divider";
  pillRow.appendChild(divider);

  const cats = ctx.prefs.enabledCategories ?? CATEGORY_OPTIONS.map((c) => c.key);
  for (const cat of CATEGORY_OPTIONS) {
    const pill = document.createElement("button");
    pill.className = `ctrl-pill cat-pill${cats.includes(cat.key) ? " active" : ""}`;
    pill.setAttribute("title", cat.label);
    pill.innerHTML = `<span class="eq-icon">${cat.icon}</span><span class="eq-text">${cat.label}</span>`;
    pill.addEventListener("click", () => {
      const cur = ctx.prefs.enabledCategories ?? CATEGORY_OPTIONS.map((c) => c.key);
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

  // Row 2: sort + show-limit + count
  const metaRow = document.createElement("div");
  metaRow.className = "ctrl-meta-row";

  // Sort select
  const sortWrap = document.createElement("div");
  sortWrap.className = "ctrl-select-wrap";
  const sortLabel = document.createElement("span");
  sortLabel.className = "ctrl-label";
  sortLabel.textContent = "Sort";
  sortWrap.appendChild(sortLabel);
  const sortSel = document.createElement("select");
  sortSel.className = "ctrl-select";
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
  sortWrap.appendChild(sortSel);
  metaRow.appendChild(sortWrap);

  // Limit select
  const limitWrap = document.createElement("div");
  limitWrap.className = "ctrl-select-wrap";
  const limitLabel = document.createElement("span");
  limitLabel.className = "ctrl-label";
  limitLabel.textContent = "Show";
  limitWrap.appendChild(limitLabel);
  const sel = document.createElement("select");
  sel.className = "ctrl-select";
  for (const n of LIMIT_OPTIONS) {
    const opt = document.createElement("option");
    opt.value = String(n);
    opt.textContent = n === 0 ? "All" : String(n);
    if ((ctx.prefs.displayLimit ?? 50) === n) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener("change", () => {
    ctx.prefs.displayLimit = Number(sel.value);
    savePrefs(ctx.prefs);
    onChange();
  });
  limitWrap.appendChild(sel);

  const countBadge = document.createElement("span");
  countBadge.className = "ctrl-count";
  countBadge.textContent = filteredCount < totalCount
    ? `${filteredCount}/${totalCount}`
    : `${totalCount}`;
  limitWrap.appendChild(countBadge);

  metaRow.appendChild(limitWrap);
  bar.appendChild(metaRow);
  container.appendChild(bar);
}

/* ── "Show more" button ──────────────────────────────── */
function renderShowMore(
  container: HTMLElement,
  allEvents: CelestialEvent[],
  alreadyShown: number,
  indexOffset: number,
): void {
  const remaining = allEvents.length - alreadyShown;
  const btn = document.createElement("button");
  btn.className = "btn btn-ghost show-more-btn";
  btn.textContent = `Show ${remaining} more`;
  btn.addEventListener("click", () => {
    btn.remove();
    const grid = document.createElement("div");
    grid.className = "card-grid";
    for (let i = alreadyShown; i < allEvents.length; i++) {
      const ev = allEvents[i];
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
      const hor = getAltAzForRaDec(s.radiantRA, s.radiantDec, ctx.location, now);
      const rs = getRiseSetForRaDec(s.radiantRA, s.radiantDec, ctx.location, now);
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
        extra: { zhr: s.zhr, speed: s.speed, parentBody: s.parentBody },
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
            const rs = getRiseSetForRaDec(d.ra, d.dec, ctx.location, now);
            return {
              id: `dso-${d.id}`,
              name: d.commonName || d.name,
              type: "dso",
              source: "catalog",
              brief: `${d.type} · Mag ${d.magnitude.toFixed(1)} in ${d.constellation}`,
              rise: rs.rise,
              set: rs.set,
              transit: rs.transit,
              altitude: hor.altitude,
              azimuth: hor.azimuth,
              magnitude: d.magnitude,
              constellation: d.constellation,
              illumination: null,
              ra: d.ra,
              dec: d.dec,
              angularSize: d.size,
              distanceAU: null,
              extra: { catalogType: d.type, size: d.size },
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
            const rs = getRiseSetForRaDec(s.ra, s.dec, ctx.location, now);
            return {
              id: `star-${s.id}`,
              name: s.name,
              type: "dso",
              source: "catalog",
              brief: `${s.spectralType} · Mag ${s.magnitude.toFixed(2)} in ${s.constellation}${s.isDouble ? ' · Double' : ''}${s.isVariable ? ' · Variable' : ''}`,
              rise: rs.rise,
              set: rs.set,
              transit: rs.transit,
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
                spectralType: s.spectralType,
                isDouble: s.isDouble,
                isVariable: s.isVariable,
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
): void {
  const grid = document.createElement("div");
  grid.className = "card-grid";
  for (let i = 0; i < events.length; i++) {
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
