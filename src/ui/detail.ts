import type { AppContext, CelestialEvent } from "../types.js";
import {
  getPlanetEvents,
  getMoonEvent,
  getAltAzForRaDec,
} from "../engine/astro.js";
import { loadDSOCatalog } from "../catalog/dso.js";
import type { DSOEntry } from "../catalog/dso.js";
import { loadStarCatalog } from "../catalog/stars.js";
import type { StarEntry } from "../catalog/stars.js";
import { METEOR_SHOWERS } from "../catalog/meteors.js";
import { renderHeader, renderNav } from "./layout.js";
import { renderFinderChart } from "../chart/finder.js";

// ── Shared helpers ─────────────────────────────────────────────────

function detailItem(label: string, value: string): string {
  return `<div class="detail-item"><div class="label">${label}</div><div class="value">${value}</div></div>`;
}

function detailSection(title: string, body: string): string {
  return `<div class="detail-section"><h3 class="detail-section-title">${title}</h3>${body}</div>`;
}

function tagList(items: string[]): string {
  if (!items.length) return '';
  return `<div class="detail-tags">${items.map(i => `<span class="tag">${i}</span>`).join('')}</div>`;
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ── Base event detail (planets, moon, etc.) ────────────────────────

function renderEventDetail(
  container: HTMLElement,
  ctx: AppContext,
  event: CelestialEvent,
): void {
  container.innerHTML = "";
  renderHeader(container, ctx);
  renderNav("#/");

  const content = document.createElement("div");
  content.innerHTML = `
    <a href="#/" class="detail-back">← Tonight</a>
    <h2 class="detail-title">${event.name}</h2>
    <p class="detail-brief">${event.brief}</p>
    <div class="detail-grid">
      ${detailItem("Altitude", event.altitude !== null ? `${event.altitude.toFixed(1)}°` : "—")}
      ${detailItem("Azimuth", event.azimuth !== null ? `${event.azimuth.toFixed(0)}°` : "—")}
      ${detailItem("Magnitude", event.magnitude !== null ? event.magnitude.toFixed(1) : "—")}
      ${detailItem("Constellation", event.constellation ?? "—")}
      ${event.rise ? detailItem("Rise", fmtTime(event.rise)) : ""}
      ${event.set ? detailItem("Set", fmtTime(event.set)) : ""}
      ${event.transit ? detailItem("Transit", fmtTime(event.transit)) : ""}
      ${event.distanceAU !== null ? detailItem("Distance", `${event.distanceAU.toFixed(3)} AU`) : ""}
      ${event.illumination !== null ? detailItem("Phase", `${(event.illumination * 100).toFixed(0)}%`) : ""}
      ${event.angularSize !== null ? detailItem("Size", `${event.angularSize.toFixed(1)}'`) : ""}
    </div>
  `;
  container.appendChild(content);

  appendFinderAndSkyView(container, event);
}

// ── DSO detail (rich) ──────────────────────────────────────────────

function renderDSODetailFull(
  container: HTMLElement,
  ctx: AppContext,
  event: CelestialEvent,
  entry: DSOEntry,
): void {
  container.innerHTML = "";
  renderHeader(container, ctx);
  renderNav("#/");

  const content = document.createElement("div");
  const displayName = entry.commonName || entry.name;
  const catalogId = entry.id !== displayName ? entry.id : '';

  let html = `
    <a href="#/" class="detail-back">← Tonight</a>
    <h2 class="detail-title">${displayName}</h2>
    ${catalogId ? `<div class="detail-catalog-id">${catalogId}</div>` : ''}
    <p class="detail-brief">${entry.description}</p>
  `;

  // Position & Visibility
  html += detailSection('Position & Visibility', `
    <div class="detail-grid">
      ${detailItem("Altitude", event.altitude !== null ? `${event.altitude.toFixed(1)}°` : "—")}
      ${detailItem("Azimuth", event.azimuth !== null ? `${event.azimuth.toFixed(0)}°` : "—")}
      ${detailItem("Magnitude", entry.magnitude.toFixed(1))}
      ${detailItem("Constellation", entry.constellation)}
      ${entry.surfaceBrightness ? detailItem("Surface Brightness", `${entry.surfaceBrightness.toFixed(1)} mag/arcmin²`) : ''}
      ${entry.bestSeason ? detailItem("Best Season", entry.bestSeason) : ''}
      ${detailItem("Apparent Size", `${entry.size.toFixed(1)}'`)}
    </div>
  `);

  // Physical Properties
  const physProps: string[] = [];
  if (entry.type) physProps.push(detailItem("Type", entry.type.replace(/-/g, ' ')));
  if (entry.morphology) physProps.push(detailItem("Morphology", entry.morphology));
  if (entry.physicalSize) physProps.push(detailItem("Physical Size", entry.physicalSize));
  if (entry.distanceLY) physProps.push(detailItem("Distance", `${entry.distanceLY.toLocaleString()} ly`));
  if (entry.distancePC) physProps.push(detailItem("Distance", `${entry.distancePC.toLocaleString()} pc`));
  if (physProps.length) {
    html += detailSection('Physical Properties', `<div class="detail-grid">${physProps.join('')}</div>`);
  }

  // Notable Features
  if (entry.notableFeatures.length) {
    html += detailSection('Notable Features', tagList(entry.notableFeatures));
  }

  // Sub-Objects
  if (entry.subObjects.length) {
    html += detailSection('Sub-Objects & Companions', tagList(entry.subObjects));
  }

  // Discovery
  if (entry.discoverer || entry.yearDiscovered) {
    html += detailSection('Discovery', `
      <div class="detail-grid">
        ${entry.discoverer ? detailItem("Discoverer", entry.discoverer) : ''}
        ${entry.yearDiscovered ? detailItem("Year", entry.yearDiscovered < 0 ? `${Math.abs(entry.yearDiscovered)} BC` : String(entry.yearDiscovered)) : ''}
      </div>
    `);
  }

  // Imaging Notes
  if (entry.imagingNotes) {
    html += detailSection('Imaging Notes', `<p class="detail-prose">${entry.imagingNotes}</p>`);
  }

  content.innerHTML = html;
  container.appendChild(content);

  appendFinderAndSkyView(container, event);
}

// ── Star detail (rich) ─────────────────────────────────────────────

function renderStarDetailFull(
  container: HTMLElement,
  ctx: AppContext,
  event: CelestialEvent,
  entry: StarEntry,
): void {
  container.innerHTML = "";
  renderHeader(container, ctx);
  renderNav("#/");

  const content = document.createElement("div");
  const designation = [entry.bayerDesignation, entry.flamsteedNumber, entry.constellation]
    .filter(Boolean).join(' ');

  let html = `
    <a href="#/" class="detail-back">← Tonight</a>
    <h2 class="detail-title">${entry.name}</h2>
    ${designation ? `<div class="detail-catalog-id">${designation}</div>` : ''}
    <p class="detail-brief">${entry.description}</p>
  `;

  // Position & Visibility
  html += detailSection('Position & Visibility', `
    <div class="detail-grid">
      ${detailItem("Altitude", event.altitude !== null ? `${event.altitude.toFixed(1)}°` : "—")}
      ${detailItem("Azimuth", event.azimuth !== null ? `${event.azimuth.toFixed(0)}°` : "—")}
      ${detailItem("Apparent Mag", entry.magnitude.toFixed(2))}
      ${detailItem("Absolute Mag", entry.absMagnitude.toFixed(2))}
      ${detailItem("Constellation", entry.constellation)}
      ${detailItem("Spectral Type", entry.spectralType || "—")}
    </div>
  `);

  // Distance & Motion
  const distItems: string[] = [];
  if (entry.distanceLY) distItems.push(detailItem("Distance", `${entry.distanceLY.toLocaleString()} light-years`));
  if (entry.distancePC) distItems.push(detailItem("Distance", `${entry.distancePC.toLocaleString()} parsecs`));
  if (entry.properMotion) distItems.push(detailItem("Proper Motion", entry.properMotion));
  if (distItems.length) {
    html += detailSection('Distance & Motion', `<div class="detail-grid">${distItems.join('')}</div>`);
  }

  // Physical Properties
  const physItems: string[] = [];
  if (entry.luminosity) physItems.push(detailItem("Luminosity", entry.luminosity));
  if (entry.mass) physItems.push(detailItem("Mass", entry.mass));
  if (entry.radius) physItems.push(detailItem("Radius", entry.radius));
  if (entry.temperature) physItems.push(detailItem("Temperature", `${entry.temperature.toLocaleString()} K`));
  if (entry.colorIndex !== null) physItems.push(detailItem("Color Index (B-V)", entry.colorIndex.toFixed(2)));
  if (entry.age) physItems.push(detailItem("Age", entry.age));
  if (physItems.length) {
    html += detailSection('Physical Properties', `<div class="detail-grid">${physItems.join('')}</div>`);
  }

  // Double Star
  if (entry.isDouble && entry.doubleCompanion) {
    html += detailSection('Double / Multiple Star', `<p class="detail-prose">${entry.doubleCompanion}</p>`);
  }

  // Variable Star
  if (entry.isVariable) {
    const varItems: string[] = [];
    if (entry.variableType) varItems.push(detailItem("Type", entry.variableType));
    if (entry.variablePeriod) varItems.push(detailItem("Period", entry.variablePeriod));
    html += detailSection('Variable Star', varItems.length
      ? `<div class="detail-grid">${varItems.join('')}</div>`
      : `<p class="detail-prose">This star is a known variable.</p>`
    );
  }

  // Exoplanets
  if (entry.hasExoplanets) {
    html += detailSection('Exoplanets', `
      <div class="detail-grid">
        ${detailItem("Known Planets", String(entry.exoplanetCount))}
      </div>
      ${entry.exoplanetNotes ? `<p class="detail-prose">${entry.exoplanetNotes}</p>` : ''}
    `);
  }

  // Notable Features
  if (entry.notableFeatures.length) {
    html += detailSection('Notable Features', tagList(entry.notableFeatures));
  }

  content.innerHTML = html;
  container.appendChild(content);

  appendFinderAndSkyView(container, event);
}

// ── Shared chart + SkyView image ───────────────────────────────────

function appendFinderAndSkyView(container: HTMLElement, event: CelestialEvent): void {
  if (event.ra !== null && event.dec !== null) {
    const chartDiv = document.createElement("div");
    chartDiv.className = "chart-container";
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 400;
    chartDiv.appendChild(canvas);
    container.appendChild(chartDiv);
    renderFinderChart(canvas, event.ra, event.dec, event.name);

    const img = document.createElement("img");
    img.className = "skyview-img skeleton";
    img.alt = `SkyView image of ${event.name}`;
    img.loading = "lazy";
    img.src = `https://skyview.gsfc.nasa.gov/current/cgi/runquery.pl?Position=${event.ra},${event.dec}&Survey=DSS2+Red&Size=0.5&Pixels=300&Return=PNG`;
    img.onload = () => img.classList.remove("skeleton");
    container.appendChild(img);
  }
}

// ── Route handlers ─────────────────────────────────────────────────

export function renderDetail(
  container: HTMLElement,
  ctx: AppContext,
  eventId: string,
): void {
  const now = new Date();
  const event = findEvent(ctx, eventId, now);
  if (!event) {
    container.innerHTML = "";
    renderHeader(container, ctx);
    renderNav("#/");
    container.innerHTML +=
      '<p style="padding:20px;color:var(--text-dim)">Event not found.</p>';
    return;
  }
  renderEventDetail(container, ctx, event);
}

export async function renderDSODetail(
  container: HTMLElement,
  ctx: AppContext,
  dsoId: string,
): Promise<void> {
  container.innerHTML = "";
  renderHeader(container, ctx);
  renderNav("#/");
  container.innerHTML +=
    '<p style="padding:20px;color:var(--text-dim)">Loading…</p>';

  const catalog = await loadDSOCatalog();
  const raw = dsoId.replace("dso-", "");
  const entry = catalog.find((d) => d.id === raw);
  if (!entry) {
    container.innerHTML = "";
    renderHeader(container, ctx);
    renderNav("#/");
    container.innerHTML +=
      '<p style="padding:20px;color:var(--text-dim)">Object not found.</p>';
    return;
  }
  const now = new Date();
  const hor = getAltAzForRaDec(entry.ra, entry.dec, ctx.location, now);
  const event: CelestialEvent = {
    id: dsoId,
    name: entry.commonName || entry.name,
    type: "dso",
    source: "catalog",
    brief: `${entry.type} · Mag ${entry.magnitude.toFixed(1)} in ${entry.constellation}`,
    rise: null,
    set: null,
    transit: null,
    altitude: hor.altitude,
    azimuth: hor.azimuth,
    magnitude: entry.magnitude,
    constellation: entry.constellation,
    illumination: null,
    ra: entry.ra,
    dec: entry.dec,
    angularSize: entry.size,
    distanceAU: null,
    extra: { catalogType: entry.type, size: entry.size },
  };
  renderDSODetailFull(container, ctx, event, entry);
}

export async function renderStarDetail(
  container: HTMLElement,
  ctx: AppContext,
  starId: string,
): Promise<void> {
  container.innerHTML = "";
  renderHeader(container, ctx);
  renderNav("#/");
  container.innerHTML +=
    '<p style="padding:20px;color:var(--text-dim)">Loading…</p>';

  const catalog = await loadStarCatalog();
  const raw = starId.replace("star-", "");
  const entry = catalog.find((s) => s.id === raw);
  if (!entry) {
    container.innerHTML = "";
    renderHeader(container, ctx);
    renderNav("#/");
    container.innerHTML +=
      '<p style="padding:20px;color:var(--text-dim)">Star not found.</p>';
    return;
  }
  const now = new Date();
  const hor = getAltAzForRaDec(entry.ra, entry.dec, ctx.location, now);
  const event: CelestialEvent = {
    id: starId,
    name: entry.name,
    type: "dso",
    source: "catalog",
    brief: `${entry.spectralType} · Mag ${entry.magnitude.toFixed(2)} in ${entry.constellation}`,
    rise: null,
    set: null,
    transit: null,
    altitude: hor.altitude,
    azimuth: hor.azimuth,
    magnitude: entry.magnitude,
    constellation: entry.constellation,
    illumination: null,
    ra: entry.ra,
    dec: entry.dec,
    angularSize: null,
    distanceAU: null,
    extra: {},
  };
  renderStarDetailFull(container, ctx, event, entry);
}

function findEvent(
  ctx: AppContext,
  id: string,
  date: Date,
): CelestialEvent | null {
  if (id === "moon") return getMoonEvent(ctx.location, date);
  if (id.startsWith("planet-")) {
    const planets = getPlanetEvents(ctx.location, date);
    return planets.find((p) => p.id === id) ?? null;
  }
  if (id.startsWith("meteor-")) {
    const sid = id.replace("meteor-", "");
    const shower = METEOR_SHOWERS.find((s) => s.id === sid);
    if (!shower) return null;
    const hor = getAltAzForRaDec(
      shower.radiantRA,
      shower.radiantDec,
      ctx.location,
      date,
    );
    return {
      id,
      name: shower.name,
      type: "meteor-shower",
      source: "catalog",
      brief: `ZHR ${shower.zhr} · ${shower.speed} km/s`,
      rise: null,
      set: null,
      transit: null,
      altitude: hor.altitude,
      azimuth: hor.azimuth,
      magnitude: null,
      constellation: null,
      illumination: null,
      ra: shower.radiantRA,
      dec: shower.radiantDec,
      angularSize: null,
      distanceAU: null,
      extra: { zhr: shower.zhr, parentBody: shower.parentBody },
    };
  }
  return null;
}
