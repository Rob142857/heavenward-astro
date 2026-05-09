import type { AppContext, CelestialEvent } from "../types.js";
import {
  getPlanetEvents,
  getMoonEvent,
  getAltAzForRaDec,
  getRiseSetForRaDec,
  azimuthToCompassShort,
  altitudeDescription,
} from "../engine/astro.js";
import { loadDSOCatalog } from "../catalog/dso.js";
import type { DSOEntry } from "../catalog/dso.js";
import { loadStarCatalog } from "../catalog/stars.js";
import type { StarEntry } from "../catalog/stars.js";
import { METEOR_SHOWERS } from "../catalog/meteors.js";
import type { MeteorShower } from "../catalog/meteors.js";
import { renderHeader, renderNav } from "./layout.js";
import { renderFinderChart } from "../chart/finder.js";
import { buildSkyContext } from "../engine/nearby.js";
import type { SkyContext, NearbyObject } from "../engine/nearby.js";
import {
  getLLMStatus,
  loadLLM,
  generateSkyNarrative,
} from "../services/llm.js";
import { navigate } from "./router.js";

// ── Abort controller for LLM — cancelled on every route change ────

let llmAbort: AbortController | null = null;

function abortLLM(): void {
  if (llmAbort) {
    llmAbort.abort();
    llmAbort = null;
  }
}

function freshAbort(): AbortController {
  abortLLM();
  llmAbort = new AbortController();
  return llmAbort;
}

// Abort any running LLM when user navigates away
window.addEventListener("hashchange", abortLLM);

// ── Shared helpers ─────────────────────────────────────────────────

function wikiLink(name: string, display?: string): string {
  const slug = name.trim().replace(/\s+/g, "_");
  return `<a href="https://en.wikipedia.org/wiki/${encodeURIComponent(slug)}" target="_blank" rel="noopener" class="wiki-link">${display ?? name}</a>`;
}

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
      ${detailItem("Azimuth", event.azimuth !== null ? `${event.azimuth.toFixed(0)}° ${azimuthToCompassShort(event.azimuth ?? 0)}` : "—")}
      ${detailItem("Magnitude", event.magnitude !== null ? event.magnitude.toFixed(1) : "—")}
      ${detailItem("Constellation", event.constellation ? wikiLink(event.constellation + " (constellation)", event.constellation) : "—")}
      ${event.rise ? detailItem("Rise", fmtTime(event.rise)) : ""}
      ${event.set ? detailItem("Set", fmtTime(event.set)) : ""}
      ${event.transit ? detailItem("Transit", fmtTime(event.transit)) : ""}
      ${event.distanceAU !== null ? detailItem("Distance", `${event.distanceAU.toFixed(3)} AU`) : ""}
      ${event.illumination !== null ? detailItem("Phase", `${(event.illumination * 100).toFixed(0)}%`) : ""}
      ${event.angularSize !== null ? detailItem("Size", `${event.angularSize.toFixed(1)}'`) : ""}
    </div>
  `;
  container.appendChild(content);

  appendLLMSection(container, event, ctx);
  appendFinderAndSkyView(container, event);
  appendSkyContext(container, event, ctx);
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
      ${detailItem("Constellation", wikiLink(entry.constellation + " (constellation)", entry.constellation))}
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
        ${entry.discoverer ? detailItem("Discoverer", wikiLink(entry.discoverer)) : ''}
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

  appendLLMSection(container, event, ctx);
  appendFinderAndSkyView(container, event);
  appendSkyContext(container, event, ctx);
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
      ${detailItem("Constellation", wikiLink(entry.constellation + " (constellation)", entry.constellation))}
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

  appendLLMSection(container, event, ctx);
  appendFinderAndSkyView(container, event);
  appendSkyContext(container, event, ctx);
}

// ── Shared chart + imagery ─────────────────────────────────────────

function appendFinderAndSkyView(container: HTMLElement, event: CelestialEvent): void {
  if (event.ra === null || event.dec === null) return;

  // Finder chart
  const chartDiv = document.createElement("div");
  chartDiv.className = "chart-container";
  const canvas = document.createElement("canvas");
  canvas.width = 400;
  canvas.height = 400;
  chartDiv.appendChild(canvas);
  container.appendChild(chartDiv);
  renderFinderChart(canvas, event.ra, event.dec, event.name);

  // Image section: try Wikimedia Commons → SkyView DSS2 → fallback link
  const imgWrap = document.createElement("div");
  imgWrap.className = "object-image-wrap skeleton";
  imgWrap.style.marginTop = "16px";
  container.appendChild(imgWrap);

  loadBestImage(event, imgWrap);
}

interface WikiImageResult {
  url: string;
  descriptionUrl: string;
  artist: string;
}

async function searchWikimediaCommons(name: string): Promise<WikiImageResult | null> {
  // Normalize search terms: "Orion Nebula", "M42", etc.
  const terms = encodeURIComponent(name);
  const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${terms}%20astronomy&gsrlimit=5&prop=imageinfo&iiprop=url|extmetadata|size|mime&iiurlwidth=600&format=json&origin=*`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await resp.json() as {
      query?: {
        pages?: Record<string, {
          imageinfo?: Array<{
            thumburl?: string;
            url: string;
            descriptionurl: string;
            mime: string;
            width: number;
            height: number;
            extmetadata?: { Artist?: { value: string } };
          }>;
        }>;
      };
    };

    const pages = data.query?.pages;
    if (!pages) return null;

    // Find the best image: prefer larger, skip SVGs and tiny images
    for (const page of Object.values(pages)) {
      const info = page.imageinfo?.[0];
      if (!info) continue;
      if (info.mime === "image/svg+xml") continue;
      if (info.width < 200 || info.height < 200) continue;

      const imgUrl = info.thumburl ?? info.url;
      const artist = info.extmetadata?.Artist?.value ?? "";
      // Strip HTML from artist
      const cleanArtist = artist.replace(/<[^>]+>/g, "").trim();

      return {
        url: imgUrl,
        descriptionUrl: info.descriptionurl,
        artist: cleanArtist || "Wikimedia Commons",
      };
    }
    return null;
  } catch {
    return null;
  }
}

function loadBestImage(event: CelestialEvent, wrap: HTMLElement): void {
  const objectName = event.name;
  const wikiSlug = objectName.trim().replace(/\s+/g, "_");
  const wikiPageUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(wikiSlug)}`;

  searchWikimediaCommons(objectName).then((result) => {
    wrap.classList.remove("skeleton");

    if (result) {
      // Wikimedia Commons image found
      wrap.innerHTML = `
        <img class="object-img" src="${result.url}" alt="${objectName}" loading="lazy" />
        <div class="image-attribution">
          <span>📷 ${result.artist}</span>
          <a href="${result.descriptionUrl}" target="_blank" rel="noopener" class="wiki-link">Wikimedia Commons</a>
        </div>
      `;
      const img = wrap.querySelector("img") as HTMLImageElement;
      img.onerror = () => fallbackToSkyView(event, wrap, wikiPageUrl);
      return;
    }

    // No Commons result — try SkyView DSS2
    fallbackToSkyView(event, wrap, wikiPageUrl);
  });
}

function fallbackToSkyView(
  event: CelestialEvent,
  wrap: HTMLElement,
  wikiPageUrl: string,
): void {
  if (event.ra === null || event.dec === null) {
    showNoImage(wrap, event.name, wikiPageUrl);
    return;
  }

  const skyviewUrl = `https://skyview.gsfc.nasa.gov/current/cgi/runquery.pl?Position=${event.ra},${event.dec}&Survey=DSS2+Red&Size=0.5&Pixels=400&Return=PNG`;
  wrap.innerHTML = `
    <img class="object-img" src="${skyviewUrl}" alt="DSS2 survey image of ${event.name}" loading="lazy" />
    <div class="image-attribution">
      <span>DSS2 Red survey via <a href="https://skyview.gsfc.nasa.gov/" target="_blank" rel="noopener" class="wiki-link">NASA SkyView</a></span>
      <a href="${wikiPageUrl}" target="_blank" rel="noopener" class="wiki-link">View on Wikipedia</a>
    </div>
  `;
  const img = wrap.querySelector("img") as HTMLImageElement;
  img.onerror = () => showNoImage(wrap, event.name, wikiPageUrl);
}

function showNoImage(wrap: HTMLElement, name: string, wikiPageUrl: string): void {
  wrap.innerHTML = `
    <div class="image-unavailable">
      <p>No image available at present</p>
      <a href="${wikiPageUrl}" target="_blank" rel="noopener" class="wiki-link">Try Wikipedia →</a>
    </div>
  `;
}

// ── Meteor shower detail (rich) ────────────────────────────────────

function renderMeteorDetailFull(
  container: HTMLElement,
  ctx: AppContext,
  event: CelestialEvent,
  shower: MeteorShower,
): void {
  container.innerHTML = "";
  renderHeader(container, ctx);
  renderNav("#/");

  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const isPeak = month === shower.peakMonth && day === shower.peakDay;
  const daysFromPeak = daysBetween(month, day, shower.peakMonth, shower.peakDay);

  const content = document.createElement("div");

  let html = `
    <a href="#/" class="detail-back">← Tonight</a>
    <h2 class="detail-title">${shower.name}</h2>
    <p class="detail-brief">Meteor shower from parent body ${wikiLink(shower.parentBody)}</p>
  `;

  // Activity status
  const statusTag = isPeak
    ? '<span class="tag tag-peak">Peak Tonight!</span>'
    : daysFromPeak <= 3
      ? `<span class="tag tag-near-peak">${daysFromPeak} day${daysFromPeak > 1 ? 's' : ''} from peak</span>`
      : `<span class="tag">Active</span>`;

  html += `<div class="detail-tags" style="margin-bottom:16px">${statusTag}</div>`;

  // Observing info
  html += detailSection('Observing Information', `
    <div class="detail-grid">
      ${detailItem("Altitude", event.altitude !== null ? `${event.altitude.toFixed(1)}°` : "—")}
      ${detailItem("Direction", event.azimuth !== null ? `${event.azimuth.toFixed(0)}° ${azimuthToCompassShort(event.azimuth)}` : "—")}
      ${detailItem("Look", event.altitude !== null ? altitudeDescription(event.altitude) : "—")}
      ${detailItem("ZHR", String(shower.zhr))}
      ${detailItem("Speed", `${shower.speed} km/s`)}
      ${detailItem("Parent Body", wikiLink(shower.parentBody))}
      ${event.rise ? detailItem("Radiant Rise", fmtTime(event.rise)) : ""}
      ${event.set ? detailItem("Radiant Set", fmtTime(event.set)) : ""}
      ${event.transit ? detailItem("Radiant Transit", fmtTime(event.transit)) : ""}
    </div>
  `);

  // Activity window
  html += detailSection('Activity Window', `
    <div class="detail-grid">
      ${detailItem("Start", `${monthName(shower.startMonth)} ${shower.startDay}`)}
      ${detailItem("Peak", `${monthName(shower.peakMonth)} ${shower.peakDay}`)}
      ${detailItem("End", `${monthName(shower.endMonth)} ${shower.endDay}`)}
      ${detailItem("Duration", `${activityDays(shower)} days`)}
    </div>
  `);

  // Observing tips
  const speedDesc = shower.speed > 60 ? "very fast"
    : shower.speed > 45 ? "fast"
    : shower.speed > 30 ? "medium-speed"
    : "slow";

  const tips = [
    `Look away from the radiant point for longer meteor trails.`,
    `${speedDesc.charAt(0).toUpperCase() + speedDesc.slice(1)} meteors (${shower.speed} km/s) — ${shower.speed > 50 ? 'expect bright streaks' : 'watch for bright fireballs'}.`,
    `Best viewing after midnight when the radiant is highest.`,
    `Allow 20 minutes for your eyes to fully dark-adapt.`,
    `ZHR ${shower.zhr} is the theoretical maximum under perfect conditions — expect roughly half that in practice.`,
  ];
  html += detailSection('Observing Tips', `
    <div class="meteor-tips">
      ${tips.map(t => `<p class="detail-prose" style="margin-bottom:8px">• ${t}</p>`).join('')}
    </div>
  `);

  content.innerHTML = html;
  container.appendChild(content);

  appendLLMSection(container, event, ctx);
  appendFinderAndSkyView(container, event);
  appendSkyContext(container, event, ctx);
}

function monthName(m: number): string {
  return ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m] ?? "";
}

function daysBetween(m1: number, d1: number, m2: number, d2: number): number {
  const a = new Date(2000, m1 - 1, d1);
  const b = new Date(2000, m2 - 1, d2);
  return Math.abs(Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

function activityDays(s: MeteorShower): number {
  return daysBetween(s.startMonth, s.startDay, s.endMonth, s.endDay);
}

// ── Sky Context section (nearby objects + LLM) ─────────────────────

function appendSkyContext(
  container: HTMLElement,
  event: CelestialEvent,
  ctx: AppContext,
): void {
  if (event.ra === null || event.dec === null) return;

  const wrapper = document.createElement("div");
  wrapper.className = "sky-context";
  wrapper.innerHTML = `
    <h3 class="detail-section-title">Sky Guide</h3>
    <div class="sky-context-loading">
      <div class="skeleton" style="height:60px;border-radius:8px"></div>
    </div>
  `;
  container.appendChild(wrapper);

  const now = new Date();
  buildSkyContext(event, ctx.location, now).then((skyCtx) => {
    wrapper.innerHTML = "";
    renderSkyContextContent(wrapper, skyCtx, event, ctx);
  });
}

function renderSkyContextContent(
  wrapper: HTMLElement,
  skyCtx: SkyContext,
  event: CelestialEvent,
  ctx: AppContext,
): void {
  // Looking direction callout
  const dirBox = document.createElement("div");
  dirBox.className = "sky-direction-box";
  dirBox.innerHTML = `
    <div class="sky-direction-compass">${skyCtx.target.compassShort}</div>
    <div class="sky-direction-text">
      <strong>Face ${skyCtx.target.lookDirection}</strong> — ${skyCtx.target.altDescription}
      (${Math.round(skyCtx.target.altitude)}° up)
    </div>
  `;
  wrapper.appendChild(dirBox);

  // Template-based description
  if (skyCtx.lookingDescription) {
    const descSection = document.createElement("div");
    descSection.className = "detail-section";
    descSection.innerHTML = `
      <h3 class="detail-section-title">Where To Look</h3>
      <p class="detail-prose">${skyCtx.lookingDescription}</p>
    `;
    wrapper.appendChild(descSection);
  }

  // Nearby objects
  if (skyCtx.nearby.length) {
    const nearbySection = document.createElement("div");
    nearbySection.className = "detail-section";
    nearbySection.innerHTML = `<h3 class="detail-section-title">Nearby Objects</h3>`;
    const grid = document.createElement("div");
    grid.className = "nearby-grid";

    for (const obj of skyCtx.nearby) {
      const card = document.createElement("div");
      card.className = "nearby-card";
      card.addEventListener("click", () => navigate(`#/detail/${obj.id}`));
      card.innerHTML = `
        <div class="nearby-card-header">
          <span class="nearby-name">${obj.name}</span>
          <span class="nearby-sep">${obj.separation.toFixed(1)}°</span>
        </div>
        <div class="nearby-type">${obj.type}${obj.magnitude !== null ? ` · mag ${obj.magnitude.toFixed(1)}` : ''}</div>
        <div class="nearby-dir">${obj.direction}${obj.constellation ? ` · ${obj.constellation}` : ''}</div>
      `;
      grid.appendChild(card);
    }

    nearbySection.appendChild(grid);
    wrapper.appendChild(nearbySection);
  }

  // Photography tips
  if (skyCtx.photographyTips.length) {
    const photoSection = document.createElement("div");
    photoSection.className = "detail-section";
    photoSection.innerHTML = `
      <h3 class="detail-section-title">Photography</h3>
      ${skyCtx.photographyTips.map(t => `<p class="detail-prose" style="margin-bottom:6px">• ${t}</p>`).join('')}
    `;
    wrapper.appendChild(photoSection);
  }
}

function sanitizeLLMHtml(raw: string): string {
  const div = document.createElement("div");
  div.textContent = raw;
  // Re-enable only <a> tags with href/target/rel
  return div.innerHTML.replace(
    /&lt;a\s+href=&quot;(https:\/\/en\.wikipedia\.org\/wiki\/[^&]+)&quot;(?:\s+target=&quot;_blank&quot;)?(?:\s+rel=&quot;noopener&quot;)?&gt;([^&]+)&lt;\/a&gt;/g,
    (_, url, text) => `<a href="${url}" target="_blank" rel="noopener" class="wiki-link">${text}</a>`,
  );
}

// ── LLM section (top of detail, always button-activated) ──────────

function appendLLMSection(
  container: HTMLElement,
  event: CelestialEvent,
  ctx: AppContext,
): void {
  if (event.ra === null || event.dec === null) return;
  if (getLLMStatus() === "unavailable") return;

  const section = document.createElement("div");
  section.className = "detail-section llm-section";

  const status = getLLMStatus();
  const btnLabel = status === "ready"
    ? "Load AI Commentary on This Location"
    : "Load AI Commentary on This Location (~4 GB model)";

  section.innerHTML = `
    <h3 class="detail-section-title">AI Sky Guide</h3>
    <button class="btn btn-outline btn-block llm-activate-btn">${btnLabel}</button>
    <div class="llm-progress" style="display:none">
      <div class="llm-progress-bar"><div class="llm-progress-fill"></div></div>
      <p class="llm-progress-text detail-prose"></p>
    </div>
    <p class="llm-narrative detail-prose" style="display:none"></p>
  `;
  container.appendChild(section);

  const btn = section.querySelector(".llm-activate-btn") as HTMLButtonElement;
  const progress = section.querySelector(".llm-progress") as HTMLElement;
  const fill = section.querySelector(".llm-progress-fill") as HTMLElement;
  const progressText = section.querySelector(".llm-progress-text") as HTMLElement;
  const narrative = section.querySelector(".llm-narrative") as HTMLElement;

  btn.addEventListener("click", () => {
    btn.style.display = "none";
    const abort = freshAbort();

    const runGeneration = (skyCtx: SkyContext) => {
      if (abort.signal.aborted) return;
      narrative.style.display = "block";
      narrative.textContent = "Generating...";
      generateSkyNarrative(skyCtx, (text) => {
        if (!abort.signal.aborted) narrative.innerHTML = sanitizeLLMHtml(text);
      }, abort.signal).catch(() => {
        if (!abort.signal.aborted) narrative.textContent = "Could not generate description.";
      });
    };

    if (getLLMStatus() === "ready") {
      // Model already loaded — build context then generate
      progress.style.display = "block";
      progressText.textContent = "Building sky context...";
      fill.style.width = "100%";
      buildSkyContext(event, ctx.location, new Date()).then((skyCtx) => {
        progress.style.display = "none";
        runGeneration(skyCtx);
      });
    } else {
      // Need to load model first
      progress.style.display = "block";
      loadLLM((text, pct) => {
        if (abort.signal.aborted) return;
        progressText.textContent = text;
        fill.style.width = `${(pct * 100).toFixed(0)}%`;
      }).then((ok) => {
        if (abort.signal.aborted) return;
        progress.style.display = "none";
        if (!ok) {
          narrative.style.display = "block";
          narrative.textContent = "Could not load AI model. WebGPU may not be supported.";
          return;
        }
        buildSkyContext(event, ctx.location, new Date()).then((skyCtx) => {
          if (!abort.signal.aborted) runGeneration(skyCtx);
        });
      });
    }
  });
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

  // Meteor showers get dedicated detail view
  if (eventId.startsWith("meteor-")) {
    const sid = eventId.replace("meteor-", "");
    const shower = METEOR_SHOWERS.find((s) => s.id === sid);
    if (shower) {
      renderMeteorDetailFull(container, ctx, event, shower);
      return;
    }
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
  const rs = getRiseSetForRaDec(entry.ra, entry.dec, ctx.location, now);
  const event: CelestialEvent = {
    id: dsoId,
    name: entry.commonName || entry.name,
    type: "dso",
    source: "catalog",
    brief: `${entry.type} · Mag ${entry.magnitude.toFixed(1)} in ${entry.constellation}`,
    rise: rs.rise,
    set: rs.set,
    transit: rs.transit,
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
  const rs = getRiseSetForRaDec(entry.ra, entry.dec, ctx.location, now);
  const event: CelestialEvent = {
    id: starId,
    name: entry.name,
    type: "dso",
    source: "catalog",
    brief: `${entry.spectralType} · Mag ${entry.magnitude.toFixed(2)} in ${entry.constellation}`,
    rise: rs.rise,
    set: rs.set,
    transit: rs.transit,
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
    const rs = getRiseSetForRaDec(
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
      rise: rs.rise,
      set: rs.set,
      transit: rs.transit,
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
