import type { AppContext, CelestialEvent, TwilightTimes } from "../types.js";
import {
  getTwilightTimes,
  getPlanetEvents,
  getMoonEvent,
} from "../engine/astro.js";
import { loadDSOCatalog } from "../catalog/dso.js";
import { METEOR_SHOWERS } from "../catalog/meteors.js";
import { getAltAzForRaDec } from "../engine/astro.js";
import { renderHeader, renderNav } from "./layout.js";
import { navigate } from "./router.js";

export function renderTonight(container: HTMLElement, ctx: AppContext): void {
  container.innerHTML = "";
  renderHeader(container, ctx);
  renderNav("#/");

  const now = new Date();
  const twilight = getTwilightTimes(ctx.location, now);

  renderTwilightBar(container, twilight);

  const events: CelestialEvent[] = [];

  if (ctx.prefs.enabledSources.includes("moon")) {
    events.push(getMoonEvent(ctx.location, now));
  }
  if (ctx.prefs.enabledSources.includes("planets")) {
    events.push(...getPlanetEvents(ctx.location, now));
  }

  // DSOs (async)
  if (ctx.prefs.enabledSources.includes("dso")) {
    // Show skeleton cards while loading
    const skelHolder = document.createElement("div");
    skelHolder.setAttribute("data-dso-skel", "");
    for (let i = 0; i < 3; i++) {
      const skel = document.createElement("div");
      skel.className = "card skeleton skeleton-card";
      skel.style.setProperty("--i", String(i));
      skelHolder.appendChild(skel);
    }
    container.appendChild(skelHolder);

    loadDSOCatalog().then((dsos) => {
      skelHolder.remove();
      const dsoEvents = dsos
        .filter((d) => d.magnitude <= ctx.prefs.magnitudeLimit)
        .map((d): CelestialEvent => {
          const hor = getAltAzForRaDec(d.ra, d.dec, ctx.location, now);
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
            extra: { catalogType: d.type, size: d.size },
          };
        })
        .filter((e) => (e.altitude ?? 0) > 0);
      renderEventCards(container, dsoEvents);
    });
  }

  // Meteors active now
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
      return {
        id: `meteor-${s.id}`,
        name: s.name,
        type: "meteor-shower",
        source: "catalog",
        brief: `ZHR ${s.zhr} · ${s.speed} km/s · Parent: ${s.parentBody}`,
        rise: null,
        set: null,
        transit: null,
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

  // Sort: visible first (altitude > 0), then by magnitude
  const visible = events
    .filter((e) => (e.altitude ?? -1) > 0)
    .sort((a, b) => (a.magnitude ?? 99) - (b.magnitude ?? 99));

  const below = events
    .filter((e) => (e.altitude ?? -1) <= 0)
    .sort((a, b) => (a.magnitude ?? 99) - (b.magnitude ?? 99));

  const section = document.createElement("h3");
  section.className = "section-title";
  section.textContent = `Visible Now (${visible.length})`;
  container.appendChild(section);

  renderEventCards(container, visible, 0);

  if (below.length) {
    const belowSection = document.createElement("h3");
    belowSection.className = "section-title";
    belowSection.textContent = `Below Horizon (${below.length})`;
    container.appendChild(belowSection);
    renderEventCards(container, below, visible.length);
  }
}

function renderTwilightBar(container: HTMLElement, tw: TwilightTimes): void {
  const bar = document.createElement("div");
  bar.className = "twilight-bar";
  bar.innerHTML = `
    <h2>Twilight</h2>
    <div class="twilight-visual"></div>
    <div class="twilight-grid">
      <span class="label">Sunset</span><span class="time">${fmt(tw.sunset)}</span>
      <span class="label">Civil dusk</span><span class="time">${fmt(tw.civilDusk)}</span>
      <span class="label">Nautical dusk</span><span class="time">${fmt(tw.nauticalDusk)}</span>
      <span class="label">Astro dusk</span><span class="time">${fmt(tw.astronomicalDusk)}</span>
      <span class="label">Astro dawn</span><span class="time">${fmt(tw.astronomicalDawn)}</span>
      <span class="label">Sunrise</span><span class="time">${fmt(tw.sunrise)}</span>
      <span class="label">Dark hours</span><span class="time dark-hours">${tw.nightDurationHours.toFixed(1)}h</span>
    </div>
  `;
  container.appendChild(bar);
}

function renderEventCards(
  container: HTMLElement,
  events: CelestialEvent[],
  startIndex = 0,
): void {
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const isUp = (ev.altitude ?? -1) > 0;
    const card = document.createElement("div");
    card.className = `card card-type-${ev.type}`;
    card.style.setProperty("--i", String(startIndex + i));
    card.addEventListener("click", () => navigate(`#/detail/${ev.id}`));
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
    container.appendChild(card);
  }
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
