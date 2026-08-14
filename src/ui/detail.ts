import type { AppContext, CelestialEvent, SortBy } from "../types.js";
import {
  getPlanetEvents,
  getMoonEvent,
  getAltAzForRaDec,
  getRiseSetForRaDec,
  azimuthToCompassShort,
  altitudeDescription,
} from "../engine/astro.js";
import { loadDSOCatalog, getDSOById } from "../catalog/dso.js";
import type { DSOEntry } from "../catalog/dso.js";
import { loadStarCatalog, getStarById } from "../catalog/stars.js";
import type { StarEntry } from "../catalog/stars.js";
import { METEOR_SHOWERS } from "../catalog/meteors.js";
import type { MeteorShower } from "../catalog/meteors.js";
import { getCatalogProvenance } from "../catalog/provenance.js";
import {
  constellationName,
  constellationWikiTitle,
} from "../catalog/constellations.js";
import { renderHeader, renderNav } from "./layout.js";
import { renderFinderChart } from "../chart/finder.js";
import type { FieldStar } from "../chart/finder.js";
import { buildSkyContext, nearbyObjectTypeLabel } from "../engine/nearby.js";
import type { SkyContext, NearbyObject } from "../engine/nearby.js";
import {
  getLLMStatus,
  getLLMError,
  loadLLM,
  startSkyConversation,
  getModelSizeMB,
  getModelLabel,
  getLLMDiagnostics,
  checkGPUCapability,
  setAIQuality,
} from "../services/llm.js";
import type { SkyConversation } from "../services/llm.js";
import { navigate } from "./router.js";
import { SORT_OPTIONS } from "./filterOptions.js";
import { savePrefs } from "../services/prefs.js";
import { recordObservation } from "../services/observations.js";
import { t, detectLocale } from "../i18n/translations.js";
import { mythologySummary } from "../catalog/mythology.js";
import { historyTopic, historySummary } from "../catalog/history.js";
import { namesakeThing, namesakeSummary } from "../catalog/namesakes.js";

// ── Breadcrumb trail for nearby-object navigation ─────────────────

interface BreadcrumbEntry {
  id: string;
  name: string;
  separation: number | null; // degrees from previous entry
}

let breadcrumbTrail: BreadcrumbEntry[] = [];

/** Push current object onto trail before navigating to a nearby object.
 *  separationToNext = angular distance from current object to the nearby target. */
export function pushBreadcrumb(
  currentId: string,
  currentName: string,
  separationToNext: number,
): void {
  breadcrumbTrail.push({
    id: currentId,
    name: currentName,
    separation: separationToNext,
  });
}

/** Restore trail from history.state (called by route handler on every detail entry). */
export function restoreBreadcrumb(): void {
  const state = history.state as { breadcrumb?: BreadcrumbEntry[] } | null;
  breadcrumbTrail = Array.isArray(state?.breadcrumb) ? state.breadcrumb : [];
}

function renderBreadcrumb(currentName: string): string {
  const parts: string[] = [];

  // "Tonight" root — always shown
  parts.push(
    `<a href="#/" class="bc-link bc-root" data-bc-action="root">${t("detail.breadcrumbHome")}</a>`,
  );

  // Trail entries with separation arrows between them
  for (let i = 0; i < breadcrumbTrail.length; i++) {
    const entry = breadcrumbTrail[i];
    const sep =
      entry.separation !== null ? `${entry.separation.toFixed(1)}°` : "";
    parts.push(`<span class="bc-sep">${sep ? ` — ${sep} →` : " →"}</span>`);
    parts.push(`<a class="bc-link" data-bc-index="${i}">${entry.name}</a>`);
  }

  // Current object (not clickable)
  if (breadcrumbTrail.length) {
    parts.push(`<span class="bc-sep"> →</span>`);
  }
  parts.push(`<span class="bc-current">${currentName}</span>`);

  return `<nav class="detail-breadcrumb">${parts.join("")}</nav>`;
}

function attachBreadcrumbHandlers(container: HTMLElement): void {
  const nav = container.querySelector(".detail-breadcrumb");
  if (!nav) return;

  nav.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains("bc-link")) return;
    e.preventDefault();

    const action = target.dataset.bcAction;
    if (action === "root") {
      breadcrumbTrail = [];
      navigate("#/");
      return;
    }

    const idx = parseInt(target.dataset.bcIndex ?? "", 10);
    if (isNaN(idx)) return;

    // Navigate to the clicked trail entry, keeping trail up to (not including) it
    const entry = breadcrumbTrail[idx];
    breadcrumbTrail = breadcrumbTrail.slice(0, idx);
    navigate(`#/detail/${entry.id}`, { breadcrumb: [...breadcrumbTrail] });
  });
}

// ── Abort controller for LLM — cancelled on every route change ────

let llmAbort: AbortController | null = null;
let detailRenderVersion = 0;

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
// router.ts's navigate() uses history.pushState, which fires no native event
// — this is the only signal for that path, so an in-flight generation must
// subscribe to it too, not just hashchange.
window.addEventListener("app:navigate", abortLLM);
window.addEventListener("hashchange", () => {
  detailRenderVersion += 1;
});
window.addEventListener("app:navigate", () => {
  detailRenderVersion += 1;
});

// ── Shared helpers ─────────────────────────────────────────────────

function wikiLink(name: string, display?: string): string {
  const slug = name.trim().replace(/\s+/g, "_");
  return `<a href="https://en.wikipedia.org/wiki/${encodeURIComponent(slug)}" target="_blank" rel="noopener" class="wiki-link">${display ?? name}</a>`;
}

/**
 * The catalog's description field is a machine-generated stub for all but a
 * handful of objects — "GCl in Aqr. Magnitude 6.3." on 4,998 of 5,019 DSOs
 * and 5,043 of 5,054 stars. Every fact in it (type, constellation,
 * magnitude) already appears in the grid immediately below, so rendering it
 * repeated the same three values twice on ~10,000 pages. Only the genuinely
 * written descriptions survive the length test.
 */
function curatedBrief(description: string): string {
  if (!description || description.length <= 80) return "";
  return `<p class="detail-brief">${description}</p>`;
}

function detailItem(label: string, value: string): string {
  return `<div class="detail-item"><div class="label">${label}</div><div class="value">${value}</div></div>`;
}

function detailSourceItem(event: CelestialEvent): string {
  const key = sourceKeyForEvent(event);
  if (!key) return "";
  const source = getCatalogProvenance(key);
  if (!source) return "";
  return detailItem(
    t("detail.label.source"),
    `<a href="#/about/sources" class="wiki-link">${source.label}</a>`,
  );
}

function sourceKeyForEvent(event: CelestialEvent): string | null {
  const sourceKey = event.extra.sourceKey;
  if (typeof sourceKey === "string") return sourceKey;
  if (event.id.startsWith("star-")) return "stars";
  if (event.id.startsWith("dso-")) return "dso";
  if (event.id.startsWith("meteor-")) return "meteors";

  switch (event.type) {
    case "planet":
      return "planets";
    case "moon":
      return "moon";
    case "eclipse":
      return "eclipses";
    case "conjunction":
      return "conjunctions";
    default:
      return null;
  }
}

function detailSection(title: string, body: string): string {
  return `<div class="detail-section"><h3 class="detail-section-title">${title}</h3>${body}</div>`;
}

function tagList(items: string[]): string {
  if (!items.length) return "";
  return `<div class="detail-tags">${items.map((i) => `<span class="tag">${i}</span>`).join("")}</div>`;
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
    ${renderBreadcrumb(event.name)}
    <h2 class="detail-title">${event.name}</h2>
    <p class="detail-brief">${event.brief}</p>
    <div class="detail-grid">
      ${detailItem(t("detail.label.altitude"), event.altitude !== null ? `${event.altitude.toFixed(1)}°` : "—")}
      ${detailItem(t("detail.label.azimuth"), event.azimuth !== null ? `${event.azimuth.toFixed(0)}° ${azimuthToCompassShort(event.azimuth ?? 0)}` : "—")}
      ${detailItem(t("detail.label.magnitude"), event.magnitude !== null ? event.magnitude.toFixed(1) : "—")}
      ${detailItem(t("detail.label.constellation"), event.constellation ? wikiLink(constellationWikiTitle(event.constellation) ?? event.constellation, constellationName(event.constellation) ?? event.constellation) : "—")}
      ${detailSourceItem(event)}
      ${event.rise ? detailItem(t("detail.label.rise"), fmtTime(event.rise)) : ""}
      ${event.set ? detailItem(t("detail.label.set"), fmtTime(event.set)) : ""}
      ${event.transit ? detailItem(t("detail.label.transit"), fmtTime(event.transit)) : ""}
      ${event.distanceAU !== null ? detailItem(t("detail.label.distance"), `${event.distanceAU.toFixed(3)} AU`) : ""}
      ${event.illumination !== null ? detailItem(t("detail.label.phase"), `${(event.illumination * 100).toFixed(0)}%`) : ""}
      ${event.angularSize !== null ? detailItem(t("detail.label.size"), `${event.angularSize.toFixed(1)}'`) : ""}
    </div>
  `;
  container.appendChild(content);
  attachBreadcrumbHandlers(container);

  appendFinderAndSkyView(container, event);
  appendSkyContext(container, event, ctx);
  // AI guide last: it is opt-in, costs a large download, and is the one
  // section a reader cannot act on without tapping. The chart, image and
  // where-to-look material are what someone came for, so they should not sit
  // below a button most visitors never press. This also makes the AI
  // conversation genuinely the end of the page.
  appendLLMSection(container, event, ctx);
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
  const catalogId = entry.id !== displayName ? entry.id : "";

  const caldwellText = entry.caldwell
    ? t("detail.caldwellLabel", { code: entry.caldwell })
    : "";

  let html = `
    ${renderBreadcrumb(displayName)}
    <h2 class="detail-title">${displayName}</h2>
    ${catalogId ? `<div class="detail-catalog-id">${catalogId}${caldwellText ? ` \u00b7 ${caldwellText}` : ""}</div>` : caldwellText ? `<div class="detail-catalog-id">${caldwellText}</div>` : ""}
    ${curatedBrief(entry.description)}
  `;

  // Position & Visibility
  html += detailSection(
    t("detail.section.positionVisibility"),
    `
    <div class="detail-grid">
      ${detailItem(t("detail.label.altitude"), event.altitude !== null ? `${event.altitude.toFixed(1)}°` : "—")}
      ${detailItem(t("detail.label.azimuth"), event.azimuth !== null ? `${event.azimuth.toFixed(0)}°` : "—")}
      ${detailItem(t("detail.label.magnitudeV"), entry.magnitude.toFixed(1))}
      ${entry.bMagnitude !== null && entry.bMagnitude !== undefined ? detailItem(t("detail.label.magnitudeB"), entry.bMagnitude.toFixed(1)) : ""}
      ${detailItem(t("detail.label.constellation"), wikiLink(constellationWikiTitle(entry.constellation) ?? entry.constellation, constellationName(entry.constellation) ?? entry.constellation))}
      ${detailSourceItem(event)}
      ${entry.surfaceBrightness ? detailItem(t("detail.label.surfaceBrightness"), `${entry.surfaceBrightness.toFixed(1)} mag/arcmin²`) : ""}
      ${entry.bestSeason ? detailItem(t("detail.label.bestSeason"), entry.bestSeason) : ""}
      ${detailItem(
        t("detail.label.apparentSize"),
        entry.minorAxis && entry.minorAxis > 0 && entry.minorAxis < entry.size
          ? `${entry.size.toFixed(1)}' × ${entry.minorAxis.toFixed(1)}'`
          : `${entry.size.toFixed(1)}'`,
      )}
      ${entry.positionAngle !== null && entry.positionAngle !== undefined ? detailItem(t("detail.label.positionAngle"), `${entry.positionAngle.toFixed(0)}°`) : ""}
    </div>
  `,
  );

  // Physical Properties
  const physProps: string[] = [];
  if (entry.type)
    physProps.push(detailItem(t("detail.label.type"), entry.type.replace(/-/g, " ")));
  if (entry.morphology)
    physProps.push(detailItem(t("detail.label.morphology"), entry.morphology));
  if (entry.physicalSize)
    physProps.push(detailItem(t("detail.label.physicalSize"), entry.physicalSize));
  if (entry.distanceLY)
    physProps.push(
      detailItem(t("detail.label.distance"), `${entry.distanceLY.toLocaleString()} ly`),
    );
  if (entry.distancePC)
    physProps.push(
      detailItem(t("detail.label.distance"), `${entry.distancePC.toLocaleString()} pc`),
    );
  if (physProps.length) {
    html += detailSection(
      t("detail.section.physicalProperties"),
      `<div class="detail-grid">${physProps.join("")}</div>`,
    );
  }

  // Notable Features
  if (entry.notableFeatures.length) {
    html += detailSection(t("detail.section.notableFeatures"), tagList(entry.notableFeatures));
  }

  // Sub-Objects
  if (entry.subObjects.length) {
    html += detailSection(
      t("detail.section.subObjects"),
      tagList(entry.subObjects),
    );
  }

  // Discovery
  if (entry.discoverer || entry.yearDiscovered) {
    html += detailSection(
      t("detail.section.discovery"),
      `
      <div class="detail-grid">
        ${entry.discoverer ? detailItem(t("detail.label.discoverer"), wikiLink(entry.discoverer)) : ""}
        ${entry.yearDiscovered ? detailItem(t("detail.label.year"), entry.yearDiscovered < 0 ? t("detail.yearBC", { year: Math.abs(entry.yearDiscovered) }) : String(entry.yearDiscovered)) : ""}
      </div>
    `,
    );
  }

  // Imaging Notes
  if (entry.imagingNotes) {
    html += detailSection(
      t("detail.section.imagingNotes"),
      `<p class="detail-prose">${entry.imagingNotes}</p>`,
    );
  }

  content.innerHTML = html;
  container.appendChild(content);
  attachBreadcrumbHandlers(container);

  appendFinderAndSkyView(container, event);
  appendSkyContext(container, event, ctx);
  // AI guide last: it is opt-in, costs a large download, and is the one
  // section a reader cannot act on without tapping. The chart, image and
  // where-to-look material are what someone came for, so they should not sit
  // below a button most visitors never press. This also makes the AI
  // conversation genuinely the end of the page.
  appendLLMSection(container, event, ctx);
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
  const designation = [
    entry.bayerDesignation,
    entry.flamsteedNumber,
    entry.constellation,
  ]
    .filter(Boolean)
    .join(" ");

  let html = `
    ${renderBreadcrumb(entry.name)}
    <h2 class="detail-title">${entry.name}</h2>
    ${designation ? `<div class="detail-catalog-id">${designation}</div>` : ""}
    ${curatedBrief(entry.description)}
  `;

  // Position & Visibility
  html += detailSection(
    t("detail.section.positionVisibility"),
    `
    <div class="detail-grid">
      ${detailItem(t("detail.label.altitude"), event.altitude !== null ? `${event.altitude.toFixed(1)}°` : "—")}
      ${detailItem(t("detail.label.azimuth"), event.azimuth !== null ? `${event.azimuth.toFixed(0)}°` : "—")}
      ${detailItem(t("detail.label.apparentMag"), entry.magnitude.toFixed(2))}
      ${detailItem(t("detail.label.absoluteMag"), entry.absMagnitude.toFixed(2))}
      ${detailItem(t("detail.label.constellation"), wikiLink(constellationWikiTitle(entry.constellation) ?? entry.constellation, constellationName(entry.constellation) ?? entry.constellation))}
      ${detailSourceItem(event)}
      ${detailItem(t("detail.label.spectralType"), entry.spectralType || "—")}
    </div>
  `,
  );

  // Distance & Motion
  const distItems: string[] = [];
  if (entry.distanceLY)
    distItems.push(
      detailItem(
        t("detail.label.distance"),
        t("detail.unitLightYears", { value: entry.distanceLY.toLocaleString() }),
      ),
    );
  if (entry.distancePC)
    distItems.push(
      detailItem(t("detail.label.distance"), t("detail.unitParsecs", { value: entry.distancePC.toLocaleString() })),
    );
  if (entry.properMotion)
    distItems.push(detailItem(t("detail.label.properMotion"), entry.properMotion));
  if (entry.radialVelocity !== null && entry.radialVelocity !== undefined)
    distItems.push(
      detailItem(
        t("detail.label.radialVelocity"),
        `${entry.radialVelocity > 0 ? "+" : ""}${entry.radialVelocity.toFixed(1)} km/s`,
      ),
    );
  if (distItems.length) {
    html += detailSection(
      t("detail.section.distanceMotion"),
      `<div class="detail-grid">${distItems.join("")}</div>`,
    );
  }

  // Physical Properties
  const physItems: string[] = [];
  if (entry.luminosity)
    physItems.push(detailItem(t("detail.label.luminosity"), entry.luminosity));
  if (entry.mass) physItems.push(detailItem(t("detail.label.mass"), entry.mass));
  if (entry.radius) physItems.push(detailItem(t("detail.label.radius"), entry.radius));
  if (entry.temperature)
    physItems.push(
      detailItem(t("detail.label.temperature"), `${entry.temperature.toLocaleString()} K`),
    );
  if (entry.colorIndex !== null)
    physItems.push(
      detailItem(t("detail.label.colorIndex"), entry.colorIndex.toFixed(2)),
    );
  if (entry.age) physItems.push(detailItem(t("detail.label.age"), entry.age));
  if (physItems.length) {
    html += detailSection(
      t("detail.section.physicalProperties"),
      `<div class="detail-grid">${physItems.join("")}</div>`,
    );
  }

  // Double Star
  if (entry.isDouble && entry.doubleCompanion) {
    html += detailSection(
      t("detail.section.doubleStar"),
      `<p class="detail-prose">${entry.doubleCompanion}</p>
       <p class="detail-source">${t("detail.sourceUSNO")}</p>`,
    );
  }

  // Variable Star
  if (entry.isVariable) {
    const varItems: string[] = [];
    if (entry.variableType)
      varItems.push(detailItem(t("detail.label.type"), entry.variableType));
    if (entry.variablePeriod)
      varItems.push(detailItem(t("detail.label.period"), entry.variablePeriod));
    if (entry.variableRange)
      varItems.push(detailItem(t("detail.label.range"), entry.variableRange));
    html += detailSection(
      t("detail.section.variableStar"),
      `${
        varItems.length
          ? `<div class="detail-grid">${varItems.join("")}</div>`
          : `<p class="detail-prose">${t("detail.variableStarFallback")}</p>`
      }
       <p class="detail-source">${t("detail.sourceGCVS")}</p>`,
    );
  }

  // Exoplanets
  if (entry.hasExoplanets) {
    html += detailSection(
      t("detail.section.exoplanets"),
      `
      <div class="detail-grid">
        ${detailItem(t("detail.label.knownPlanets"), String(entry.exoplanetCount))}
      </div>
      ${entry.exoplanetNotes ? `<p class="detail-prose">${entry.exoplanetNotes}</p>` : ""}
      <p class="detail-source">${t("detail.sourceNASAExoplanet")}</p>
    `,
    );
  }

  // Notable Features
  if (entry.notableFeatures.length) {
    html += detailSection(t("detail.section.notableFeatures"), tagList(entry.notableFeatures));
  }

  content.innerHTML = html;
  container.appendChild(content);
  attachBreadcrumbHandlers(container);
  appendFinderAndSkyView(container, event);
  appendSkyContext(container, event, ctx);
  // AI guide last: it is opt-in, costs a large download, and is the one
  // section a reader cannot act on without tapping. The chart, image and
  // where-to-look material are what someone came for, so they should not sit
  // below a button most visitors never press. This also makes the AI
  // conversation genuinely the end of the page.
  appendLLMSection(container, event, ctx);
}

// ── Shared chart + imagery ─────────────────────────────────────────

function appendFinderAndSkyView(
  container: HTMLElement,
  event: CelestialEvent,
): void {
  if (event.ra === null || event.dec === null) return;

  const targetRA = event.ra;
  const targetDec = event.dec;
  const fov = 5; // degrees, matches finder.ts

  // Finder chart
  const chartDiv = document.createElement("div");
  chartDiv.className = "chart-container";
  const canvas = document.createElement("canvas");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = 400 * dpr;
  canvas.height = 400 * dpr;
  chartDiv.appendChild(canvas);
  container.appendChild(chartDiv);

  // Load field stars then render chart
  loadStarCatalog()
    .then((stars) => {
      const cosDec = Math.cos((targetDec * Math.PI) / 180);
      const halfFovRA = fov / (15 * Math.max(cosDec, 0.01));
      const halfFovDec = fov / 2;
      const nearby: FieldStar[] = [];
      for (const s of stars) {
        if (
          Math.abs(s.ra - targetRA) < halfFovRA &&
          Math.abs(s.dec - targetDec) < halfFovDec &&
          s.magnitude <= 6.5
        ) {
          nearby.push({
            ra: s.ra,
            dec: s.dec,
            magnitude: s.magnitude,
            name: s.name,
          });
        }
      }
      renderFinderChart(canvas, targetRA, targetDec, event.name, nearby);
    })
    .catch(() => {
      renderFinderChart(canvas, targetRA, targetDec, event.name);
    });

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

// Bare catalog identifiers (M2, NGC 2244, IC 1396, C14, ...) are short and
// ambiguous — a free-text Commons search for "M2" collides with completely
// unrelated files (vehicles, weapons, model numbers). Objects with a real
// common name ("Orion Nebula") are specific enough to search reliably.
const BARE_CATALOG_ID_RE = /^(M|NGC|IC|C)\s?\d+[A-Za-z]?$/i;

function isBareCatalogId(name: string): boolean {
  return BARE_CATALOG_ID_RE.test(name.trim());
}

const IMAGE_SEARCH_STOPWORDS = new Set([
  "astronomy",
  "and",
  "the",
  "in",
  "of",
  "with",
]);

function humanizeCatalogType(catalogType: string | undefined): string {
  return catalogType ? catalogType.replace(/-/g, " ") : "";
}

// Build a disambiguated search query for objects whose bare name is too
// short/ambiguous on its own, using whatever context CelestialEvent already
// carries (constellation, DSO type in `extra.catalogType`).
function buildImageSearchQuery(event: CelestialEvent): string {
  if (isBareCatalogId(event.name)) {
    const catalogType = humanizeCatalogType(
      event.extra.catalogType as string | undefined,
    );
    return [event.name, catalogType, event.constellation]
      .filter(Boolean)
      .join(" ");
  }
  return event.name;
}

function significantTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((tok) => tok.length >= 3 && !IMAGE_SEARCH_STOPWORDS.has(tok));
}

// Loose relevance check: accept a Commons candidate only if its title shares
// a meaningful word with the query, or literally contains the catalog code
// as its own token (e.g. "NGC 2244" in "NGC 2244 Rosette Nebula.jpg"). This
// is a safety net, not a guarantee — see loadBestImage() for how bare
// catalog IDs prefer the astrometrically-correct SkyView cutout instead.
/**
 * Things humans build and name after the sky. A celestial object's photograph
 * does not depict hardware, so any of these in a filename means the match is
 * about the namesake rather than the object — the failure that put a picture
 * of the ANTARES neutrino telescope on the star Antares' page.
 */
const NAMESAKE_ARTEFACT_TOKENS = new Set([
  "telescope",
  "detector",
  "experiment",
  "laboratory",
  "spacecraft",
  "satellite",
  "rocket",
  "launcher",
  "probe",
  "mission",
  "module",
  "submarine",
  "ship",
  "aircraft",
  "logo",
  "emblem",
  "map",
  "flag",
  "stamp",
  "coin",
  "building",
  "hotel",
  "station",
]);

function isRelevantTitle(title: string, event: CelestialEvent): boolean {
  const titleTokens = new Set(title.toLowerCase().split(/[^a-z0-9]+/));

  // Reject namesakes before anything else — they otherwise sail through the
  // name check below, because they genuinely do carry the object's name.
  for (const tok of titleTokens) {
    if (NAMESAKE_ARTEFACT_TOKENS.has(tok)) return false;
  }

  const catalogCode = event.name.trim().toLowerCase();
  if (catalogCode && titleTokens.has(catalogCode.replace(/\s+/g, ""))) {
    return true;
  }
  const queryTokens = significantTokens(buildImageSearchQuery(event));
  if (queryTokens.length === 0) return true;
  return queryTokens.some((tok) => titleTokens.has(tok));
}

async function searchWikimediaCommons(
  query: string,
  event: CelestialEvent,
): Promise<WikiImageResult | null> {
  const terms = encodeURIComponent(query);
  const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${terms}%20astronomy&gsrlimit=5&prop=imageinfo&iiprop=url|extmetadata|size|mime&iiurlwidth=600&format=json&origin=*`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = (await resp.json()) as {
      query?: {
        pages?: Record<
          string,
          {
            title?: string;
            imageinfo?: Array<{
              thumburl?: string;
              url: string;
              descriptionurl: string;
              mime: string;
              width: number;
              height: number;
              extmetadata?: { Artist?: { value: string } };
            }>;
          }
        >;
      };
    };

    const pages = data.query?.pages;
    if (!pages) return null;

    // Walk all candidates (not just the first) and only accept one that
    // passes both the format/size check and the relevance check.
    for (const page of Object.values(pages)) {
      const info = page.imageinfo?.[0];
      if (!info) continue;
      // Only allow raster images — skip SVGs, PDFs, videos, audio, etc.
      if (!info.mime.startsWith("image/") || info.mime === "image/svg+xml")
        continue;
      if (info.width < 200 || info.height < 200) continue;
      if (!page.title || !isRelevantTitle(page.title, event)) continue;

      const imgUrl = info.thumburl ?? info.url;
      const artist = info.extmetadata?.Artist?.value ?? "";
      // Strip HTML from artist
      const cleanArtist = artist.replace(/<[^>]+>/g, "").trim();

      return {
        url: imgUrl,
        descriptionUrl: info.descriptionurl,
        artist: cleanArtist || t("detail.wikimediaCommons"),
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
  const searchQuery = buildImageSearchQuery(event);

  // Prefer the positional image — SkyView's DSS2 cutout is queried by RA/Dec,
  // so it is astrometrically guaranteed to show the right patch of sky —
  // wherever a name search is untrustworthy. Two cases qualify:
  //
  //   • Bare catalog IDs ("M2", "NGC 2244"), which collide with unrelated
  //     content of every kind.
  //   • STARS, whose names are borrowed constantly by the things humans
  //     build. Searching Commons for "Antares" returned the ANTARES neutrino
  //     telescope on the Mediterranean seabed — a photograph that passes
  //     every relevance test, because it really is named Antares and really
  //     is astronomy. A star is a point of light in any case, so a survey
  //     plate of its actual position is both truer and more useful than
  //     whatever shares its name.
  //
  // Named deep-sky objects keep Commons first: "Orion Nebula" and "Andromeda
  // Galaxy" have superb astrophotography and almost no naming collisions.
  const preferPositional =
    isBareCatalogId(objectName) || event.id.startsWith("star-");
  if (preferPositional && event.ra !== null && event.dec !== null) {
    renderSkyView(event, wrap, wikiPageUrl, () => {
      searchWikimediaCommons(searchQuery, event).then((result) => {
        if (result) {
          renderCommonsImage(result, wrap, objectName, () =>
            showNoImage(wrap, objectName, wikiPageUrl),
          );
        } else {
          showNoImage(wrap, objectName, wikiPageUrl);
        }
      });
    });
    return;
  }

  searchWikimediaCommons(searchQuery, event).then((result) => {
    if (result) {
      renderCommonsImage(result, wrap, objectName, () =>
        fallbackToSkyView(event, wrap, wikiPageUrl),
      );
      return;
    }
    // No Commons result — try SkyView DSS2
    fallbackToSkyView(event, wrap, wikiPageUrl);
  });
}

function renderCommonsImage(
  result: WikiImageResult,
  wrap: HTMLElement,
  objectName: string,
  onError: () => void,
): void {
  wrap.classList.remove("skeleton");
  wrap.innerHTML = `
    <img class="object-img" src="${result.url}" alt="${objectName}" loading="lazy" />
    <div class="image-attribution">
      <span>📷 ${result.artist}</span>
      <a href="${result.descriptionUrl}" target="_blank" rel="noopener" class="wiki-link">${t("detail.wikimediaCommons")}</a>
    </div>
  `;
  const img = wrap.querySelector("img") as HTMLImageElement;
  img.onerror = onError;
}

function renderSkyView(
  event: CelestialEvent,
  wrap: HTMLElement,
  wikiPageUrl: string,
  onError: () => void,
): void {
  wrap.classList.remove("skeleton");
  const skyviewUrl = `https://skyview.gsfc.nasa.gov/current/cgi/runquery.pl?Position=${event.ra},${event.dec}&Survey=DSS2+Red&Size=0.5&Pixels=400&Return=PNG`;
  wrap.innerHTML = `
    <img class="object-img" src="${skyviewUrl}" alt="${t("detail.dss2ImageAlt", { name: event.name })}" loading="lazy" />
    <div class="image-attribution">
      <span>${t("detail.dss2SurveyVia")} <a href="https://skyview.gsfc.nasa.gov/" target="_blank" rel="noopener" class="wiki-link">NASA SkyView</a></span>
      <a href="${wikiPageUrl}" target="_blank" rel="noopener" class="wiki-link">${t("detail.viewOnWikipedia")}</a>
    </div>
  `;
  const img = wrap.querySelector("img") as HTMLImageElement;
  img.onerror = onError;
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
  renderSkyView(event, wrap, wikiPageUrl, () =>
    showNoImage(wrap, event.name, wikiPageUrl),
  );
}

function showNoImage(
  wrap: HTMLElement,
  name: string,
  wikiPageUrl: string,
): void {
  wrap.innerHTML = `
    <div class="image-unavailable">
      <p>${t("detail.noImageAvailable")}</p>
      <a href="${wikiPageUrl}" target="_blank" rel="noopener" class="wiki-link">${t("detail.tryWikipedia")}</a>
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
  const daysFromPeak = daysBetween(
    month,
    day,
    shower.peakMonth,
    shower.peakDay,
  );

  const content = document.createElement("div");

  let html = `
    ${renderBreadcrumb(shower.name)}
    <h2 class="detail-title">${shower.name}</h2>
    <p class="detail-brief">${t("detail.meteorParentBodyBrief", { parentBody: wikiLink(shower.parentBody) })}</p>
  `;

  // Activity status
  const statusTag = isPeak
    ? `<span class="tag tag-peak">${t("detail.peakTonight")}</span>`
    : daysFromPeak <= 3
      ? `<span class="tag tag-near-peak">${daysFromPeak > 1 ? t("detail.daysFromPeakPlural", { days: daysFromPeak }) : t("detail.daysFromPeakSingular", { days: daysFromPeak })}</span>`
      : `<span class="tag">${t("detail.activeTag")}</span>`;

  html += `<div class="detail-tags" style="margin-bottom:16px">${statusTag}</div>`;

  // Observing info
  html += detailSection(
    t("detail.section.observingInfo"),
    `
    <div class="detail-grid">
      ${detailItem(t("detail.label.altitude"), event.altitude !== null ? `${event.altitude.toFixed(1)}°` : "—")}
      ${detailItem(t("detail.label.direction"), event.azimuth !== null ? `${event.azimuth.toFixed(0)}° ${azimuthToCompassShort(event.azimuth)}` : "—")}
      ${detailItem(t("detail.label.look"), event.altitude !== null ? altitudeDescription(event.altitude) : "—")}
      ${detailItem(t("detail.label.zhr"), String(shower.zhr))}
      ${detailItem(t("detail.label.speed"), `${shower.speed} km/s`)}
      ${detailItem(t("detail.label.parentBody"), wikiLink(shower.parentBody))}
      ${detailSourceItem(event)}
      ${event.rise ? detailItem(t("detail.label.radiantRise"), fmtTime(event.rise)) : ""}
      ${event.set ? detailItem(t("detail.label.radiantSet"), fmtTime(event.set)) : ""}
      ${event.transit ? detailItem(t("detail.label.radiantTransit"), fmtTime(event.transit)) : ""}
    </div>
  `,
  );

  // Activity window
  html += detailSection(
    t("detail.section.activityWindow"),
    `
    <div class="detail-grid">
      ${detailItem(t("detail.label.start"), `${monthName(shower.startMonth)} ${shower.startDay}`)}
      ${detailItem(t("detail.label.peak"), `${monthName(shower.peakMonth)} ${shower.peakDay}`)}
      ${detailItem(t("detail.label.end"), `${monthName(shower.endMonth)} ${shower.endDay}`)}
      ${detailItem(t("detail.label.duration"), t("detail.durationDays", { days: activityDays(shower) }))}
    </div>
  `,
  );

  // Observing tips
  const speedDescKey =
    shower.speed > 60
      ? "detail.meteorSpeed.veryFast"
      : shower.speed > 45
        ? "detail.meteorSpeed.fast"
        : shower.speed > 30
          ? "detail.meteorSpeed.mediumSpeed"
          : "detail.meteorSpeed.slow";
  const speedDesc = t(speedDescKey);

  const tips = [
    t("detail.tipLookAway"),
    t("detail.tipSpeedMeteors", {
      speedDesc,
      speed: shower.speed,
      expectation:
        shower.speed > 50
          ? t("detail.expectBrightStreaks")
          : t("detail.expectBrightFireballs"),
    }),
    t("detail.tipBestViewing"),
    t("detail.tipDarkAdapt"),
    t("detail.tipZhrMax", { zhr: shower.zhr }),
  ];
  html += detailSection(
    t("detail.section.observingTips"),
    `
    <div class="meteor-tips">
      ${tips.map((tip) => `<p class="detail-prose" style="margin-bottom:8px">• ${tip}</p>`).join("")}
    </div>
  `,
  );

  content.innerHTML = html;
  container.appendChild(content);
  attachBreadcrumbHandlers(container);

  appendFinderAndSkyView(container, event);
  appendSkyContext(container, event, ctx);
  // AI guide last: it is opt-in, costs a large download, and is the one
  // section a reader cannot act on without tapping. The chart, image and
  // where-to-look material are what someone came for, so they should not sit
  // below a button most visitors never press. This also makes the AI
  // conversation genuinely the end of the page.
  appendLLMSection(container, event, ctx);
}

const MONTH_KEYS = [
  "",
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

function monthName(m: number): string {
  const key = MONTH_KEYS[m];
  return key ? t(`detail.month.${key}`) : "";
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
  container.appendChild(wrapper);

  const showLoading = (): void => {
    const hasPosition = event.altitude !== null && event.azimuth !== null;
    const altitude = Math.round(event.altitude ?? 0);
    const compass = azimuthToCompassShort(event.azimuth ?? 0);
    wrapper.innerHTML = `
      <h3 class="detail-section-title">${t("detail.section.skyGuide")}</h3>
      ${hasPosition ? `<div class="sky-direction-box">
        <div class="sky-direction-compass">${compass}</div>
        <div class="sky-direction-text">
          <strong>${t("detail.faceDirectionLabel", { direction: compass })}</strong> — ${t("detail.altitudeUp", { altitude })}
        </div>
      </div>` : ""}
      <div class="sky-context-loading" role="status" aria-live="polite" aria-label="${t("detail.buildingSkyContext")}">
        <p class="detail-prose">${t("detail.skyGuide.loadingEnrichment")}</p>
        <div class="skeleton" style="height:60px;border-radius:8px"></div>
      </div>
    `;
  };

  const loadGuide = (): void => {
    if (!wrapper.isConnected) return;
    showLoading();
    buildSkyContext(event, ctx.location, new Date())
      .then((skyCtx) => {
        if (!wrapper.isConnected) return;
        // Keep the section title after the skeleton is replaced. Previously
        // the successful path erased it, while a failed import left only the
        // heading and an eternal skeleton — exactly backwards.
        wrapper.innerHTML = `<h3 class="detail-section-title">${t("detail.section.skyGuide")}</h3>`;
        renderSkyContextContent(wrapper, skyCtx, event, ctx, loadGuide);
      })
      .catch((err: unknown) => {
        if (!wrapper.isConnected) return;
        console.error("[Sky Guide] Could not build context", err);
        wrapper.innerHTML = `
          <h3 class="detail-section-title">${t("detail.section.skyGuide")}</h3>
          <div class="sky-context-error" role="alert">
            <p class="detail-prose">${t("detail.skyGuide.loadError")}</p>
            <button type="button" class="btn btn-outline sky-context-retry">${t("detail.skyGuide.retry")}</button>
          </div>
        `;
        wrapper
          .querySelector<HTMLButtonElement>(".sky-context-retry")
          ?.addEventListener("click", loadGuide, { once: true });
      });
  };

  loadGuide();
}

/**
 * Renders the sourced mythology and historical-astronomy entries for this
 * constellation. Until now this data existed only to seed the AI prompt, so
 * the cited Campbell and primary-source material was invisible to anyone who
 * didn't have WebGPU and several hundred megabytes to spare — which is most
 * visitors.
 *
 * Deliberately prose, not the centred italic epigraph style: these summaries
 * run 37–82 words, and at 32ch centred italic that is roughly sixteen ragged
 * lines. A quotation and a paragraph want different typography.
 */
function appendLoreSection(wrapper: HTMLElement, skyCtx: SkyContext): void {
  const myth = skyCtx.target.mythology;
  const history = skyCtx.target.history;

  // Coverage is honestly partial. Saying nothing is correct when nothing is
  // sourced — an empty section would imply the sky has no story here.
  if (!myth && history.length === 0) return;

  const section = document.createElement("div");
  section.className = "detail-section lore-section";

  const parts: string[] = [
    `<h3 class="detail-section-title">${t("detail.section.lore")}</h3>`,
  ];

  const locale = detectLocale();

  if (myth) {
    // "thin" entries are ones where Campbell discusses the figure but not the
    // constellation — the Aries summary literally opens "Campbell doesn't
    // discuss how the ram itself became a constellation". Presented plainly
    // that reads as a disclaimer dressed up as a revelation, so it gets a
    // quieter framing rather than being dropped or oversold.
    const framingKey =
      myth.connectionStrength === "thin"
        ? "detail.lore.mythThin"
        : "detail.lore.myth";
    parts.push(`
      <p class="detail-prose lore-body">${mythologySummary(myth, locale)}</p>
      <p class="lore-citation">
        <span class="lore-cite-lead">${t(framingKey, { figure: myth.figure })}</span>
        <cite class="lore-cite-work">${myth.source}</cite>
        <span class="lore-cite-detail">${myth.sourceDetail}</span>
      </p>
    `);
  }

  for (const entry of history) {
    parts.push(`
      <h4 class="lore-subheading">${historyTopic(entry, locale)}</h4>
      <p class="detail-prose lore-body">${historySummary(entry, locale)}</p>
      <p class="lore-citation">
        <span class="lore-cite-lead">${t("detail.lore.sourceLabel")}</span>
        <cite class="lore-cite-work">${entry.source}</cite>
        <span class="lore-cite-detail">${entry.sourceDetail}</span>
      </p>
    `);
  }

  parts.push(`<p class="lore-coverage">${t("detail.lore.coverage")}</p>`);
  section.innerHTML = parts.join("");
  wrapper.appendChild(section);
}

/**
 * Ships, rockets, telescopes and a public holiday that took this star's name.
 * Kept apart from the myth/history section because the sourcing rules differ:
 * these are modern corporate and government records, not Campbell or MUL.APIN.
 * Rendered for everyone, not just WebGPU users — the AI reads the same data,
 * but a cited fact shouldn't be gated behind a 2 GB download.
 */
function appendNamesakesSection(
  wrapper: HTMLElement,
  skyCtx: SkyContext,
): void {
  const namesakes = skyCtx.target.namesakes;
  if (namesakes.length === 0) return;

  const section = document.createElement("div");
  section.className = "detail-section lore-section";
  const locale = detectLocale();

  const parts: string[] = [
    `<h3 class="detail-section-title">${t("detail.section.namesakes")}</h3>`,
    `<p class="lore-coverage namesake-intro">${t("detail.namesakes.intro")}</p>`,
  ];

  for (const entry of namesakes) {
    parts.push(`
      <h4 class="lore-subheading">${namesakeThing(entry, locale)}</h4>
      <p class="detail-prose lore-body">${namesakeSummary(entry, locale)}</p>
      <p class="lore-citation">
        <span class="lore-cite-lead">${t("detail.lore.sourceLabel")}</span>
        <cite class="lore-cite-work">${entry.source}</cite>
        ${
          entry.confidence === "widely-reported"
            ? `<span class="lore-cite-detail">${t("detail.namesakes.reported")}</span>`
            : ""
        }
      </p>
    `);
  }

  section.innerHTML = parts.join("");
  wrapper.appendChild(section);
}

function renderSkyContextContent(
  wrapper: HTMLElement,
  skyCtx: SkyContext,
  event: CelestialEvent,
  ctx: AppContext,
  retry: () => void,
): void {
  // Looking direction callout
  const dirBox = document.createElement("div");
  dirBox.className = "sky-direction-box";
  dirBox.innerHTML = `
    <div class="sky-direction-compass">${skyCtx.target.compassShort}</div>
    <div class="sky-direction-text">
      <strong>${t("detail.faceDirectionLabel", { direction: skyCtx.target.compassShort })}</strong> — ${t("detail.altitudeUp", { altitude: Math.round(skyCtx.target.altitude) })}
    </div>
  `;
  wrapper.appendChild(dirBox);

  if (skyCtx.unavailableSources.length > 0) {
    const warning = document.createElement("div");
    warning.className = "sky-context-warning";
    warning.setAttribute("role", "status");
    warning.innerHTML = `
      <p class="detail-prose">${t("detail.skyGuide.partialData")}</p>
      <button type="button" class="btn btn-outline sky-context-retry">${t("detail.skyGuide.retry")}</button>
    `;
    warning
      .querySelector<HTMLButtonElement>(".sky-context-retry")
      ?.addEventListener("click", retry, { once: true });
    wrapper.appendChild(warning);
  }

  // Template-based description
  if (skyCtx.lookingDescription) {
    const descSection = document.createElement("div");
    descSection.className = "detail-section";
    descSection.innerHTML = `
      <h3 class="detail-section-title">${t("detail.section.whereToLook")}</h3>
      <p class="detail-prose">${skyCtx.lookingDescription}</p>
    `;
    wrapper.appendChild(descSection);
  }

  appendLoreSection(wrapper, skyCtx);
  appendNamesakesSection(wrapper, skyCtx);

  // Nearby objects
  if (skyCtx.nearby.length) {
    const nearbySection = document.createElement("div");
    nearbySection.className = "detail-section";

    const header = document.createElement("div");
    header.className = "nearby-header";
    header.innerHTML = `<h3 class="detail-section-title" style="margin:0;border:none;padding:0">${t("detail.section.nearbyObjects")}</h3>`;

    // Sort select
    const sortWrap = document.createElement("div");
    sortWrap.className = "ctrl-select-wrap";
    const sortLabel = document.createElement("span");
    sortLabel.className = "ctrl-label";
    sortLabel.textContent = t("common.sort.label");
    sortWrap.appendChild(sortLabel);
    const sortSel = document.createElement("select");
    sortSel.className = "ctrl-select";
    sortSel.setAttribute("aria-label", t("common.sort.label"));
    // Add "Nearest" as default for nearby context
    const nearestOpt = document.createElement("option");
    nearestOpt.value = "nearest";
    nearestOpt.textContent = t("common.sort.nearest");
    nearestOpt.selected = (ctx.prefs.sortBy ?? "brightest") === "brightest";
    sortSel.appendChild(nearestOpt);
    for (const s of SORT_OPTIONS) {
      const opt = document.createElement("option");
      opt.value = s.key;
      opt.textContent = t(s.labelKey);
      sortSel.appendChild(opt);
    }
    sortWrap.appendChild(sortSel);
    header.appendChild(sortWrap);
    nearbySection.appendChild(header);

    const grid = document.createElement("div");
    grid.className = "nearby-grid";

    let sorted = [...skyCtx.nearby];
    const renderGrid = () => {
      grid.innerHTML = "";
      for (const obj of sorted) {
        const card = document.createElement("div");
        card.className = "nearby-card";
        card.setAttribute("role", "link");
        card.tabIndex = 0;
        card.setAttribute("aria-label", obj.name);
        const openCard = (): void => {
          pushBreadcrumb(event.id, event.name, obj.separation);
          navigate(`#/detail/${obj.id}`, { breadcrumb: [...breadcrumbTrail] });
        };
        card.addEventListener("click", openCard);
        card.addEventListener("keydown", (keyEvent) => {
          if (keyEvent.key !== "Enter" && keyEvent.key !== " ") return;
          keyEvent.preventDefault();
          openCard();
        });
        card.innerHTML = `
          <div class="nearby-card-header">
            <span class="nearby-name">${obj.name}</span>
            <span class="nearby-sep">${obj.separation.toFixed(1)}°</span>
          </div>
          <div class="nearby-type">${nearbyObjectTypeLabel(obj.type)}${obj.magnitude !== null ? ` · ${t("detail.magAbbrev", { mag: obj.magnitude.toFixed(1) })}` : ""}</div>
          <div class="nearby-dir">${obj.direction}${obj.constellation ? ` · ${obj.constellation}` : ""}</div>
        `;
        grid.appendChild(card);
      }
    };

    sortSel.addEventListener("change", () => {
      const val = sortSel.value as SortBy | "nearest";
      sorted = [...skyCtx.nearby];
      switch (val) {
        case "nearest":
        case "closest":
          sorted.sort((a, b) => a.separation - b.separation);
          break;
        case "brightest":
          sorted.sort((a, b) => (a.magnitude ?? 99) - (b.magnitude ?? 99));
          break;
        case "farthest":
          sorted.sort((a, b) => b.separation - a.separation);
          break;
        case "direction":
          sorted.sort(
            (a, b) =>
              a.azimuth - b.azimuth ||
              b.altitude - a.altitude ||
              a.name.localeCompare(b.name),
          );
          break;
      }
      renderGrid();
    });

    renderGrid();
    nearbySection.appendChild(grid);
    wrapper.appendChild(nearbySection);
  }

  // Photography tips
  if (skyCtx.photographyTips.length) {
    const photoSection = document.createElement("div");
    photoSection.className = "detail-section";
    photoSection.innerHTML = `
      <h3 class="detail-section-title">${t("detail.section.photography")}</h3>
      ${skyCtx.photographyTips.map((tip) => `<p class="detail-prose" style="margin-bottom:6px">• ${tip}</p>`).join("")}
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
    (_, url, text) =>
      `<a href="${url}" target="_blank" rel="noopener" class="wiki-link">${text}</a>`,
  );
}

function formatLLMDiagnostics(): string {
  const diagnostics = getLLMDiagnostics();
  const parts: string[] = [];
  if (diagnostics.activeModelId)
    parts.push(t("detail.llmDiagModel", { id: diagnostics.activeModelId }));
  if (diagnostics.maxStorageBufferBindingSize !== null) {
    parts.push(
      t("detail.llmDiagGpuBuffer", {
        mb: Math.round(diagnostics.maxStorageBufferBindingSize / 1_048_576),
      }),
    );
  }
  if (diagnostics.deviceMemoryGB !== null)
    parts.push(t("detail.llmDiagRam", { gb: diagnostics.deviceMemoryGB }));
  if (diagnostics.gpuVendor)
    parts.push(t("detail.llmDiagGpuVendor", { vendor: diagnostics.gpuVendor }));
  return parts.length ? ` (${parts.join("; ")})` : "";
}

// ── LLM section (top of detail, always button-activated) ──────────

function appendAnswerTurn(conversation: HTMLElement): HTMLElement {
  const p = document.createElement("p");
  p.className = "llm-narrative llm-answer detail-prose";
  p.setAttribute("role", "article");
  p.setAttribute("aria-busy", "true");
  conversation.appendChild(p);
  return p;
}

function appendQuestionTurn(conversation: HTMLElement, question: string): void {
  const p = document.createElement("p");
  p.className = "llm-question detail-prose";
  p.textContent = question; // user input — textContent only, never innerHTML
  conversation.appendChild(p);
}

function appendLLMSection(
  container: HTMLElement,
  event: CelestialEvent,
  ctx: AppContext,
): void {
  if (event.ra === null || event.dec === null) return;
  if (getLLMStatus() === "unavailable") return;

  const section = document.createElement("div");
  section.className = "detail-section llm-section";

  section.innerHTML = `
    <h3 class="detail-section-title">${t("detail.section.aiSkyGuide")}</h3>
    <p class="llm-capability-check detail-prose" role="status" aria-live="polite">${t("detail.checkingDeviceCompatibility")}</p>
    <button class="btn btn-outline btn-block llm-activate-btn" style="display:none"></button>
    <div class="llm-progress" style="display:none" tabindex="-1">
      <div class="llm-progress-bar" role="progressbar" aria-label="${t("detail.aiProgressLabel")}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="llm-progress-fill"></div></div>
      <p class="llm-progress-text detail-prose" role="status" aria-live="polite"></p>
      <button type="button" class="llm-use-smaller" style="display:none">${t("detail.useSmallerModel")}</button>
      <p class="llm-use-smaller-hint" style="display:none">${t("detail.useSmallerModelHint")}</p>
    </div>
    <p class="llm-narrative detail-prose" role="status" aria-live="polite" tabindex="-1" style="display:none"></p>
    <div class="llm-conversation" style="display:none"></div>
    <p class="llm-followup-label detail-prose" style="display:none">${t("detail.followUpLabel")}</p>
    <form class="llm-followup" style="display:none">
      <input type="text" maxlength="600" class="input llm-followup-input" placeholder="${t("detail.followUpPlaceholder")}" aria-label="${t("detail.followUpPlaceholder")}" />
      <button type="submit" class="btn btn-outline llm-followup-send">${t("detail.followUpSend")}</button>
    </form>
  `;
  container.appendChild(section);

  const capMsg = section.querySelector(".llm-capability-check") as HTMLElement;
  const btn = section.querySelector(".llm-activate-btn") as HTMLButtonElement;
  const progress = section.querySelector(".llm-progress") as HTMLElement;
  const progressBar = section.querySelector(".llm-progress-bar") as HTMLElement;
  const fill = section.querySelector(".llm-progress-fill") as HTMLElement;
  const progressText = section.querySelector(
    ".llm-progress-text",
  ) as HTMLElement;
  const narrative = section.querySelector(".llm-narrative") as HTMLElement;
  const conversation = section.querySelector(
    ".llm-conversation",
  ) as HTMLElement;
  const followupLabel = section.querySelector(
    ".llm-followup-label",
  ) as HTMLElement;
  const followupForm = section.querySelector(
    ".llm-followup",
  ) as HTMLFormElement;
  const followupInput = section.querySelector(
    ".llm-followup-input",
  ) as HTMLInputElement;
  const useSmaller = section.querySelector(
    ".llm-use-smaller",
  ) as HTMLButtonElement;
  const useSmallerHint = section.querySelector(
    ".llm-use-smaller-hint",
  ) as HTMLElement;
  const followupSend = section.querySelector(
    ".llm-followup-send",
  ) as HTMLButtonElement;

  // Conversation state for this section instance — a fresh appendLLMSection
  // call (i.e. navigating to a different object) starts a fresh closure, so
  // this naturally resets per object without needing module-level state.
  let skyChat: SkyConversation | null = null;

  // Streams the opening (or a joined-load's) answer turn. Shared by the
  // ready-to-generate path and the post-load path so both fresh loads and
  // in-flight loads joined on render end up in the same place.
  const runGeneration = (skyCtx: SkyContext, abort: AbortController): void => {
    if (abort.signal.aborted) return;
    conversation.style.display = "block";
    const answer = appendAnswerTurn(conversation);
    answer.textContent = t("detail.generating");
    answer.classList.add("llm-generating");
    startSkyConversation(
      skyCtx,
      (text) => {
        if (!abort.signal.aborted) {
          answer.classList.remove("llm-generating");
          answer.innerHTML = sanitizeLLMHtml(text);
        }
      },
      abort.signal,
    )
      .then((chat) => {
        if (abort.signal.aborted) return;
        answer.classList.remove("llm-generating");
        answer.setAttribute("aria-busy", "false");
        skyChat = chat;
        if (!chat.opening) {
          answer.textContent = t("detail.emptyResponse");
        } else {
          followupLabel.style.display = "block";
          followupForm.style.display = "flex";
          followupInput.focus();
        }
      })
      .catch((err: unknown) => {
        if (!abort.signal.aborted) {
          answer.classList.remove("llm-generating");
          answer.setAttribute("aria-busy", "false");
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[LLM generate]", err);
          answer.textContent = t("detail.generateError", {
            msg,
            diagnostics: formatLLMDiagnostics(),
          });
          answer.classList.add("llm-error");
          // A failed generation must leave a way back, same as a failed
          // load — otherwise a transient hiccup is a dead end.
          btn.textContent = t("detail.aiLoadRetry");
          btn.style.display = "";
        }
      });
  };

  const buildContextThenGenerate = (abort: AbortController): void => {
    if (abort.signal.aborted) return;
    progress.style.display = "block";
    progressText.textContent = t("detail.buildingSkyContext");
    fill.classList.add("indeterminate");
    fill.style.width = "100%";
    progressBar.removeAttribute("aria-valuenow");
    progressBar.setAttribute("aria-valuetext", t("detail.buildingSkyContext"));

    buildSkyContext(event, ctx.location, new Date())
      .then((skyCtx) => {
        if (abort.signal.aborted) return;
        progress.style.display = "none";
        fill.classList.remove("indeterminate");
        progressBar.removeAttribute("aria-valuetext");
        runGeneration(skyCtx, abort);
      })
      .catch((err: unknown) => {
        if (abort.signal.aborted) return;
        console.error("[AI Sky Guide] Could not build context", err);
        progress.style.display = "none";
        fill.classList.remove("indeterminate");
        progressBar.removeAttribute("aria-valuetext");
        narrative.style.display = "block";
        narrative.textContent = t("detail.skyGuide.loadError");
        narrative.classList.add("llm-error");
        narrative.focus({ preventScroll: true });
        btn.textContent = t("detail.aiLoadRetry");
        btn.style.display = "";
      });
  };

  // Loads the model (fresh download, or joining one already in flight —
  // downloadSignal is undefined for a join, since a joiner's signal is
  // ignored by loadLLM anyway) then builds context and generates. Shared by
  // the click handler and the "already loading" render-time join so neither
  // duplicates the other's ~40 lines.
  const startLoadThenGenerate = (
    abort: AbortController,
    downloadSignal: AbortSignal | undefined,
    focusProgress: boolean,
  ): void => {
    progress.style.display = "block";
    if (focusProgress) progress.focus({ preventScroll: true });

    loadLLM((text, pct, stage) => {
      if (abort.signal.aborted) return;
      progressText.textContent = text;
      if (stage === "compile") {
        // No percentage exists for on-device compilation — an animated bar
        // plus the elapsed-seconds text is honest; a bar frozen at 100%
        // reads as a hang.
        fill.classList.add("indeterminate");
        fill.style.width = "100%";
        progressBar.removeAttribute("aria-valuenow");
        progressBar.setAttribute("aria-valuetext", text);
      } else {
        fill.classList.remove("indeterminate");
        const percent = Math.round(pct * 100);
        fill.style.width = `${percent}%`;
        progressBar.setAttribute("aria-valuenow", String(percent));
        progressBar.removeAttribute("aria-valuetext");
      }
      // The escape hatch only does something during the resumable Gemma 4
      // fetch: once compilation starts, once the WebLLM fallback chain takes
      // over (stage arrives unset), or when this call only joined a load
      // someone else started (downloadSignal undefined), there is nothing
      // left here for it to abort.
      const canOfferSmaller = downloadSignal !== undefined && stage === "download";
      useSmaller.style.display = canOfferSmaller ? "" : "none";
      useSmallerHint.style.display = canOfferSmaller ? "" : "none";
    }, downloadSignal)
      .then((ok) => {
        if (abort.signal.aborted) return;
        progress.style.display = "none";
        fill.classList.remove("indeterminate");
        progressBar.removeAttribute("aria-valuetext");
        useSmaller.style.display = "none";
        useSmallerHint.style.display = "none";
        if (!ok) {
          narrative.style.display = "block";
          narrative.textContent = `${getLLMError() ?? t("detail.couldNotLoadAIModel")}${formatLLMDiagnostics()}`;
          narrative.classList.add("llm-error");
          narrative.focus({ preventScroll: true });
          // A failed load must leave a way back — the download is resumable
          // and transient GPU conditions clear, so hiding the button forever
          // turned every hiccup into a dead end.
          btn.textContent = t("detail.aiLoadRetry");
          btn.style.display = "";
          return;
        }
        buildContextThenGenerate(abort);
      })
      .catch((err: unknown) => {
        if (abort.signal.aborted) return;
        console.error("[AI Sky Guide] Model load failed", err);
        progress.style.display = "none";
        fill.classList.remove("indeterminate");
        progressBar.removeAttribute("aria-valuetext");
        useSmaller.style.display = "none";
        useSmallerHint.style.display = "none";
        narrative.style.display = "block";
        narrative.textContent = `${t("detail.couldNotLoadAIModel")}${formatLLMDiagnostics()}`;
        narrative.classList.add("llm-error");
        narrative.focus({ preventScroll: true });
        btn.textContent = t("detail.aiLoadRetry");
        btn.style.display = "";
      });
  };

  followupForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const question = followupInput.value.trim();
    if (!question || !skyChat) return;

    followupInput.value = "";
    followupInput.disabled = true;
    followupSend.disabled = true;

    const abort = freshAbort();
    appendQuestionTurn(conversation, question);
    const answer = appendAnswerTurn(conversation);
    answer.textContent = t("detail.generating");
    answer.classList.add("llm-generating");

    skyChat
      .ask(
        question,
        (text) => {
          if (!abort.signal.aborted) {
            answer.classList.remove("llm-generating");
            answer.innerHTML = sanitizeLLMHtml(text);
          }
        },
        abort.signal,
      )
      .then((text) => {
        if (abort.signal.aborted) return;
        answer.classList.remove("llm-generating");
        answer.setAttribute("aria-busy", "false");
        if (!text) answer.textContent = t("detail.emptyResponse");
      })
      .catch((err: unknown) => {
        if (!abort.signal.aborted) {
          answer.classList.remove("llm-generating");
          answer.setAttribute("aria-busy", "false");
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[LLM follow-up]", err);
          answer.textContent = t("detail.generateError", {
            msg,
            diagnostics: formatLLMDiagnostics(),
          });
          answer.classList.add("llm-error");
        }
      })
      .finally(() => {
        followupInput.disabled = false;
        followupSend.disabled = false;
      });
  });

  // Run GPU check before showing button
  checkGPUCapability().then((cap) => {
    capMsg.style.display = "none";
    if (!cap.ok) {
      narrative.style.display = "block";
      narrative.textContent =
        cap.reason ?? t("detail.deviceCannotRunAI");
      narrative.classList.add("llm-error");
      narrative.focus({ preventScroll: true });
      return;
    }

    // Attached unconditionally — even the "loading" branch below can land on
    // a failure that redisplays this button (see startLoadThenGenerate's
    // !ok path), and it needs a listener already in place when that happens.
    btn.addEventListener("click", () => {
      btn.style.display = "none";
      // A retry after a failed load/generation starts clean — old error
      // text and a stale failed answer turn would otherwise sit above the
      // fresh progress bar contradicting it.
      narrative.style.display = "none";
      narrative.textContent = "";
      narrative.classList.remove("llm-error");
      conversation.innerHTML = "";
      conversation.style.display = "none";
      followupLabel.style.display = "none";
      followupForm.style.display = "none";
      const abort = freshAbort();

      if (getLLMStatus() === "ready") {
        // Model already loaded — build context then generate
        progress.style.display = "block";
        progress.focus({ preventScroll: true });
        buildContextThenGenerate(abort);
      } else {
        // Need to load model first. A separate controller from `abort`:
        // this one only gives up on the large model. Navigating away must
        // still cancel everything, but choosing the smaller model should
        // fall through to it rather than abandoning the whole request.
        const downloadAbort = new AbortController();
        useSmaller.disabled = false;
        useSmaller.addEventListener(
          "click",
          () => {
            useSmaller.disabled = true;
            // Downgrades the preference too, so the choice sticks rather than
            // asking again on the next object.
            setAIQuality("standard");
            downloadAbort.abort();
          },
          { once: true },
        );
        startLoadThenGenerate(abort, downloadAbort.signal, true);
      }
    });

    const status = getLLMStatus();

    if (status === "loading") {
      // A load started from another page is still running — the engine is a
      // shared singleton (see llm.ts/litert.ts), so join it and show real
      // progress instead of an idle "Load AI Commentary" button that hides
      // work already underway. btn stays hidden unless the join fails, in
      // which case startLoadThenGenerate redisplays it via the listener above.
      const abort = freshAbort();
      startLoadThenGenerate(abort, undefined, false);
      return;
    }

    // Not loading — show the idle button so a click runs the handler above.
    const sizeMB = getModelSizeMB();
    const sizeLabel =
      sizeMB >= 1000
        ? t("detail.sizeGB", { value: (sizeMB / 1000).toFixed(1) })
        : t("detail.sizeMB", { value: sizeMB });
    const modelLabel = getModelLabel();
    btn.textContent =
      status === "ready"
        ? t("detail.loadAICommentary")
        : t("detail.loadAICommentaryWithModel", { modelLabel, sizeLabel });
    btn.style.display = "";
  });
}

// ── Route handlers ─────────────────────────────────────────────────

function renderCatalogLoadError(
  container: HTMLElement,
  ctx: AppContext,
  retry: () => void,
): void {
  container.innerHTML = "";
  renderHeader(container, ctx);
  renderNav("#/");
  const state = document.createElement("div");
  state.className = "detail-section";
  state.setAttribute("role", "alert");
  state.innerHTML = `
    <p class="detail-prose">${t("common.dataLoadError")}</p>
    <button type="button" class="btn btn-outline">${t("common.tryAgain")}</button>
  `;
  state.querySelector("button")?.addEventListener("click", retry, {
    once: true,
  });
  container.appendChild(state);
}

export function renderDetail(
  container: HTMLElement,
  ctx: AppContext,
  eventId: string,
): void {
  detailRenderVersion += 1;
  const now = new Date();
  const event = findEvent(ctx, eventId, now);
  if (!event) {
    container.innerHTML = "";
    renderHeader(container, ctx);
    renderNav("#/");
    container.innerHTML += `<p style="padding:20px;color:var(--text-dim)">${t("detail.eventNotFound")}</p>`;
    return;
  }

  // Meteor showers get dedicated detail view
  if (eventId.startsWith("meteor-")) {
    const sid = eventId.replace("meteor-", "");
    const shower = METEOR_SHOWERS.find((s) => s.id === sid);
    if (shower) {
      recordObservation({
        id: event.id,
        name: event.name,
        type: event.type,
        brief: event.brief,
        location: ctx.location,
      });
      renderMeteorDetailFull(container, ctx, event, shower);
      return;
    }
  }

  recordObservation({
    id: event.id,
    name: event.name,
    type: event.type,
    brief: event.brief,
    location: ctx.location,
  });
  renderEventDetail(container, ctx, event);
}

export async function renderDSODetail(
  container: HTMLElement,
  ctx: AppContext,
  dsoId: string,
): Promise<void> {
  const renderVersion = ++detailRenderVersion;
  const isCurrent = () => renderVersion === detailRenderVersion;
  container.innerHTML = "";
  renderHeader(container, ctx);
  renderNav("#/");
  container.innerHTML += `<p style="padding:20px;color:var(--text-dim)">${t("detail.loading")}</p>`;

  const raw = dsoId.replace("dso-", "");
  let entry: DSOEntry | undefined;
  try {
    entry = await getDSOById(raw);
  } catch (err: unknown) {
    if (!isCurrent()) return;
    console.error("[Detail] DSO catalog failed", err);
    renderCatalogLoadError(container, ctx, () => {
      void renderDSODetail(container, ctx, dsoId);
    });
    return;
  }
  if (!isCurrent()) return;
  if (!entry) {
    container.innerHTML = "";
    renderHeader(container, ctx);
    renderNav("#/");
    container.innerHTML += `<p style="padding:20px;color:var(--text-dim)">${t("detail.objectNotFound")}</p>`;
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
    brief: t("detail.dsoBrief", {
      type: entry.type,
      magnitude: entry.magnitude.toFixed(1),
      constellation: entry.constellation,
    }),
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
    extra: {
      sourceKey: "dso",
      catalogType: entry.type,
      size: entry.size,
      distanceLY: entry.distanceLY,
      distancePC: entry.distancePC,
    },
  };
  recordObservation({
    id: event.id,
    name: event.name,
    type: "dso",
    brief: event.brief,
    location: ctx.location,
  });
  renderDSODetailFull(container, ctx, event, entry);
}

export async function renderStarDetail(
  container: HTMLElement,
  ctx: AppContext,
  starId: string,
): Promise<void> {
  const renderVersion = ++detailRenderVersion;
  const isCurrent = () => renderVersion === detailRenderVersion;
  container.innerHTML = "";
  renderHeader(container, ctx);
  renderNav("#/");
  container.innerHTML += `<p style="padding:20px;color:var(--text-dim)">${t("detail.loading")}</p>`;

  const raw = starId.replace("star-", "");
  let entry: StarEntry | undefined;
  try {
    entry = await getStarById(raw);
  } catch (err: unknown) {
    if (!isCurrent()) return;
    console.error("[Detail] star catalog failed", err);
    renderCatalogLoadError(container, ctx, () => {
      void renderStarDetail(container, ctx, starId);
    });
    return;
  }
  if (!isCurrent()) return;
  if (!entry) {
    container.innerHTML = "";
    renderHeader(container, ctx);
    renderNav("#/");
    container.innerHTML += `<p style="padding:20px;color:var(--text-dim)">${t("detail.starNotFound")}</p>`;
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
    brief: t("detail.starBrief", {
      spectralType: entry.spectralType,
      magnitude: entry.magnitude.toFixed(2),
      constellation: entry.constellation,
    }),
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
    extra: {
      sourceKey: "stars",
      spectralType: entry.spectralType,
      isDouble: entry.isDouble,
      isVariable: entry.isVariable,
      distanceLY: entry.distanceLY,
      distancePC: entry.distancePC,
    },
  };
  recordObservation({
    id: event.id,
    name: event.name,
    type: "star",
    brief: event.brief,
    location: ctx.location,
  });
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
      brief: t("detail.meteorBriefZhrSpeed", { zhr: shower.zhr, speed: shower.speed }),
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
      extra: {
        sourceKey: "meteors",
        zhr: shower.zhr,
        parentBody: shower.parentBody,
      },
    };
  }
  return null;
}
