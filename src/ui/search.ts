import type { AppContext, CelestialEvent } from "../types.js";
import { loadDSOCatalog, type DSOEntry } from "../catalog/dso.js";
import { loadStarCatalog, type StarEntry } from "../catalog/stars.js";
import { METEOR_SHOWERS } from "../catalog/meteors.js";
import { renderHeader, renderNav } from "./layout.js";
import { navigate } from "./router.js";
import { trackEvent } from "../services/analytics.js";
import { t } from "../i18n/translations.js";
import {
  getAltAzForRaDec,
  getPlanetEvents,
  getMoonEvent,
} from "../engine/astro.js";

/* ── Search index ─────────────────────────────────────────────────
 *
 * One flat array of lightweight entries, built once per session. The
 * `searchText` field is a pre-lowercased blob so a substring match is a
 * single .includes() call \u2014 fast enough for ~10k entries on every keystroke
 * without any external fuzzy-search library.
 */

interface SearchEntry {
  id: string; // detail-route id (e.g. "dso-M1", "star-sirius", "planet-mars")
  kind: "planet" | "moon" | "star" | "dso" | "meteor";
  name: string;
  brief: string;
  magnitude: number | null;
  constellation: string;
  catalogType: string | null;
  searchText: string;
  flags: Set<string>;
  ra: number | null; // hours
  dec: number | null; // degrees
}

let indexCache: SearchEntry[] | null = null;
let indexBuilding: Promise<SearchEntry[]> | null = null;

async function buildIndex(): Promise<SearchEntry[]> {
  if (indexCache) return indexCache;
  if (indexBuilding) return indexBuilding;
  indexBuilding = (async () => {
    const [stars, dsos] = await Promise.all([
      loadStarCatalog(),
      loadDSOCatalog(),
    ]);

    const entries: SearchEntry[] = [];

    // Stars
    for (const s of stars) {
      entries.push(starToEntry(s));
    }

    // DSOs
    for (const d of dsos) {
      entries.push(dsoToEntry(d));
    }

    // Planets (always 7) \u2014 RA/Dec is location-time-dependent so we leave
    // ra/dec null here; the result card hydrates azimuth on demand from
    // getPlanetEvents using current location/time.
    for (const name of [
      "Mercury",
      "Venus",
      "Mars",
      "Jupiter",
      "Saturn",
      "Uranus",
      "Neptune",
    ]) {
      entries.push({
        id: `planet-${name.toLowerCase()}`,
        kind: "planet",
        name,
        brief: t("search.planetBrief"),
        magnitude: null,
        constellation: "",
        catalogType: "planet",
        searchText: `${name} planet solar system`.toLowerCase(),
        flags: new Set(["planet"]),
        ra: null,
        dec: null,
      });
    }

    // Moon
    entries.push({
      id: "moon",
      kind: "moon",
      name: "Moon",
      brief: t("search.moonBrief"),
      magnitude: null,
      constellation: "",
      catalogType: "moon",
      searchText: "moon luna earth satellite".toLowerCase(),
      flags: new Set(["moon"]),
      ra: null,
      dec: null,
    });

    // Meteor showers
    for (const shower of METEOR_SHOWERS) {
      entries.push({
        id: `meteor-${shower.id}`,
        kind: "meteor",
        name: shower.name,
        brief: t("search.meteorBrief", {
          peakMonth: shower.peakMonth,
          peakDay: shower.peakDay,
          zhr: shower.zhr,
          parentBody: shower.parentBody,
        }),
        magnitude: null,
        constellation: "",
        catalogType: "meteor-shower",
        searchText: `${shower.name} ${shower.id} meteor shower ${shower.parentBody}`.toLowerCase(),
        flags: new Set(["meteor"]),
        ra: shower.radiantRA,
        dec: shower.radiantDec,
      });
    }

    indexCache = entries;
    indexBuilding = null;
    return entries;
  })();
  return indexBuilding;
}

function starToEntry(s: StarEntry): SearchEntry {
  const flags = new Set<string>(["star"]);
  if (s.isDouble) flags.add("double");
  if (s.isVariable) flags.add("variable");
  if (s.hasExoplanets) flags.add("exoplanet-host");

  const parts = [
    s.name,
    s.bayerDesignation ?? "",
    s.flamsteedNumber ? `${s.flamsteedNumber} ${s.constellation}` : "",
    s.spectralType,
    s.constellation,
    s.description,
    ...s.notableFeatures,
  ];
  return {
    id: `star-${s.id}`,
    kind: "star",
    name: s.name,
    brief: s.description,
    magnitude: s.magnitude,
    constellation: s.constellation,
    catalogType: "star",
    searchText: parts.join(" ").toLowerCase(),
    flags,
    ra: s.ra,
    dec: s.dec,
  };
}

function dsoToEntry(d: DSOEntry): SearchEntry {
  const flags = new Set<string>(["dso", d.type]);
  if (d.caldwell) flags.add("caldwell");
  if (d.id.startsWith("M") && /^M\d+$/.test(d.id)) flags.add("messier");

  // Surface feature keywords found in notableFeatures so chip search hits.
  const featuresBlob = (d.notableFeatures ?? []).join(" ").toLowerCase();
  if (/\bpulsar\b/.test(featuresBlob)) flags.add("pulsar");
  if (/\bquasar\b/.test(featuresBlob)) flags.add("quasar");
  if (/black hole|smbh|supermassive/.test(featuresBlob))
    flags.add("black-hole");
  if (
    /star.forming|stellar nursery|protostar/.test(featuresBlob) ||
    d.type === "hii-region"
  )
    flags.add("star-forming");

  const parts = [
    d.name,
    d.commonName,
    d.type,
    d.constellation,
    d.description,
    d.morphology ?? "",
    d.caldwell ?? "",
    d.caldwell ? `caldwell ${d.caldwell}` : "",
    ...(d.notableFeatures ?? []),
    ...(d.subObjects ?? []),
  ];
  return {
    id: `dso-${d.id}`,
    kind: "dso",
    name: d.commonName || (d.caldwell ? `${d.name} (${d.caldwell})` : d.name),
    brief: d.description,
    magnitude: d.magnitude,
    constellation: d.constellation,
    catalogType: d.type,
    searchText: parts.join(" ").toLowerCase(),
    flags,
    ra: d.ra,
    dec: d.dec,
  };
}

/* ── Chip taxonomy ─────────────────────────────────────────────── */

interface Chip {
  key: string;
  // Translation key, not display text \u2014 call t(chip.labelKey) at render
  // time so labels stay correct across a locale switch (this array is
  // built once at module load, before the user can have changed locale).
  labelKey: string;
  icon: string;
  // An entry matches the chip if any flag is set OR any keyword is found.
  flags?: string[];
  keywords?: string[];
}

const CHIPS: Chip[] = [
  // Solar system
  { key: "planet", labelKey: "search.chip.planet", icon: "\ud83e\ude90", flags: ["planet"] },
  { key: "moon", labelKey: "search.chip.moon", icon: "\ud83c\udf11", flags: ["moon"] },
  { key: "meteor", labelKey: "search.chip.meteor", icon: "\ud83c\udf20", flags: ["meteor"] },
  // Stars
  { key: "named-star", labelKey: "search.chip.namedStar", icon: "\u2b50", flags: ["star"] },
  { key: "double", labelKey: "search.chip.doubleStar", icon: "\u2b50\u2b50", flags: ["double"] },
  { key: "variable", labelKey: "search.chip.variable", icon: "\ud83d\udcab", flags: ["variable"] },
  { key: "exoplanet-host", labelKey: "search.chip.exoplanetHost", icon: "\ud83d\udd2d", flags: ["exoplanet-host"] },
  // Deep sky
  { key: "messier", labelKey: "search.chip.messier", icon: "M", flags: ["messier"] },
  { key: "caldwell", labelKey: "search.chip.caldwell", icon: "C", flags: ["caldwell"] },
  { key: "galaxy", labelKey: "search.chip.galaxy", icon: "\ud83c\udf0c", flags: ["galaxy", "galaxy-pair", "galaxy-group"] },
  { key: "nebula", labelKey: "search.chip.nebula", icon: "\ud83c\udf2b", flags: ["nebula", "emission-nebula", "reflection-nebula", "dark-nebula"] },
  { key: "planetary-nebula", labelKey: "search.chip.planetaryNebula", icon: "\ud83d\udc8d", flags: ["planetary-nebula"] },
  { key: "supernova-remnant", labelKey: "search.chip.supernovaRemnant", icon: "\ud83d\udca5", flags: ["supernova-remnant"] },
  { key: "open-cluster", labelKey: "search.chip.openCluster", icon: "\ud83c\udf1f", flags: ["open-cluster"] },
  { key: "globular-cluster", labelKey: "search.chip.globularCluster", icon: "\u26ea", flags: ["globular-cluster"] },
  { key: "hii-region", labelKey: "search.chip.hiiRegion", icon: "\u2728", flags: ["hii-region", "star-forming"] },
  // Phenomenon keywords (full-text)
  { key: "pulsar", labelKey: "search.chip.pulsar", icon: "\ud83d\udd06", flags: ["pulsar"], keywords: ["pulsar"] },
  { key: "black-hole", labelKey: "search.chip.blackHole", icon: "\u26ab", flags: ["black-hole"], keywords: ["black hole", "supermassive"] },
  { key: "quasar", labelKey: "search.chip.quasar", icon: "\ud83d\udca0", flags: ["quasar"], keywords: ["quasar"] },
];

function entryMatchesChip(e: SearchEntry, chip: Chip): boolean {
  if (chip.flags) {
    for (const f of chip.flags) if (e.flags.has(f)) return true;
  }
  if (chip.keywords) {
    for (const k of chip.keywords) if (e.searchText.includes(k)) return true;
  }
  return false;
}

/* ── Page render ──────────────────────────────────────────────── */

interface SearchState {
  query: string;
  activeChips: Set<string>;
}

const RESULT_LIMIT = 50;

export function renderSearch(container: HTMLElement, ctx: AppContext): void {
  container.innerHTML = "";
  renderHeader(container, ctx);
  renderNav("#/search");

  const state: SearchState = { query: "", activeChips: new Set() };

  const page = document.createElement("div");
  page.className = "search-page";
  container.appendChild(page);

  // Combined input + chip-token field (SharePoint people-picker style)
  const field = document.createElement("div");
  field.className = "search-field";
  page.appendChild(field);

  const input = document.createElement("input");
  input.type = "search";
  input.className = "search-input";
  input.placeholder = t("search.inputPlaceholder");
  input.setAttribute("aria-label", t("search.inputAriaLabel"));
  input.autocomplete = "off";
  input.autocapitalize = "off";
  input.spellcheck = false;

  // Chip palette
  const palette = document.createElement("div");
  palette.className = "search-palette";
  palette.setAttribute("role", "group");
  palette.setAttribute("aria-label", t("search.suggestedFiltersAriaLabel"));
  for (const chip of CHIPS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "search-chip-suggest";
    btn.dataset.key = chip.key;
    btn.innerHTML = `<span class="chip-icon" aria-hidden="true">${chip.icon}</span><span class="chip-label">${escape(t(chip.labelKey))}</span>`;
    btn.addEventListener("click", () => {
      if (state.activeChips.has(chip.key)) state.activeChips.delete(chip.key);
      else state.activeChips.add(chip.key);
      input.focus();
      refresh();
    });
    palette.appendChild(btn);
  }

  // Hint / empty state
  const hint = document.createElement("p");
  hint.className = "search-hint";
  hint.textContent = t("search.hint");
  page.appendChild(hint);
  page.appendChild(field);
  page.appendChild(palette);

  const results = document.createElement("div");
  results.className = "search-results";
  page.appendChild(results);

  // Build the field interior
  function paintField(): void {
    field.innerHTML = "";
    // Render token chips for any active selections
    for (const key of state.activeChips) {
      const chip = CHIPS.find((c) => c.key === key);
      if (!chip) continue;
      const token = document.createElement("span");
      token.className = "search-token";
      token.innerHTML = `<span class="chip-icon" aria-hidden="true">${chip.icon}</span><span class="chip-label">${escape(t(chip.labelKey))}</span>`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "search-token-x";
      remove.setAttribute(
        "aria-label",
        t("search.removeChip", { label: t(chip.labelKey) }),
      );
      remove.textContent = "\u00d7";
      remove.addEventListener("click", () => {
        state.activeChips.delete(key);
        refresh();
      });
      token.appendChild(remove);
      field.appendChild(token);
    }
    field.appendChild(input);
    input.focus();
  }

  function paintPalette(): void {
    palette
      .querySelectorAll<HTMLButtonElement>(".search-chip-suggest")
      .forEach((btn) => {
        const k = btn.dataset.key ?? "";
        btn.classList.toggle("active", state.activeChips.has(k));
      });
  }

  let queryToken = 0;
  async function refresh(): Promise<void> {
    paintField();
    paintPalette();
    state.query = input.value.trim();

    const myToken = ++queryToken;
    if (!state.query && state.activeChips.size === 0) {
      results.innerHTML = `<p class="search-empty">${escape(t("search.emptyStatePrompt"))}</p>`;
      return;
    }

    const entries = await buildIndex();
    if (myToken !== queryToken) return; // a newer keystroke superseded us

    const q = state.query.toLowerCase();
    const activeChips = Array.from(state.activeChips)
      .map((k) => CHIPS.find((c) => c.key === k))
      .filter((c): c is Chip => Boolean(c));

    const matches: SearchEntry[] = [];
    for (const e of entries) {
      if (q && !e.searchText.includes(q)) continue;
      let ok = true;
      for (const chip of activeChips) {
        if (!entryMatchesChip(e, chip)) {
          ok = false;
          break;
        }
      }
      if (ok) matches.push(e);
    }

    // Sort: prefer name-prefix matches, then by brightness.
    if (q) {
      matches.sort((a, b) => {
        const aHit = a.name.toLowerCase().startsWith(q) ? 0 : 1;
        const bHit = b.name.toLowerCase().startsWith(q) ? 0 : 1;
        if (aHit !== bHit) return aHit - bHit;
        return (a.magnitude ?? 99) - (b.magnitude ?? 99);
      });
    } else {
      matches.sort((a, b) => (a.magnitude ?? 99) - (b.magnitude ?? 99));
    }

    paintResults(matches);
  }

  function paintResults(matches: SearchEntry[]): void {
    results.innerHTML = "";

    const meta = document.createElement("p");
    meta.className = "search-meta";
    if (matches.length === 0) {
      results.innerHTML = `<p class="search-empty">${escape(t("search.noMatches"))}</p>`;
      return;
    }
    meta.textContent =
      matches.length > RESULT_LIMIT
        ? t("search.showingLimitedMatches", {
            limit: RESULT_LIMIT,
            total: matches.length,
          })
        : matches.length === 1
          ? t("search.matchSingular", { count: matches.length })
          : t("search.matchPlural", { count: matches.length });
    results.appendChild(meta);

    const grid = document.createElement("div");
    grid.className = "card-grid";
    const slice = matches.slice(0, RESULT_LIMIT);
    for (let i = 0; i < slice.length; i++) {
      grid.appendChild(buildResultCard(slice[i], i, ctx));
    }
    results.appendChild(grid);
  }

  // Initial paint
  paintField();
  input.addEventListener("input", () => {
    void refresh();
  });
  void refresh();
}

/* ── Result card with lazy alt/az hydration ───────────────────── */

function buildResultCard(
  e: SearchEntry,
  index: number,
  ctx: AppContext,
): HTMLElement {
  const card = document.createElement("div");
  card.className = `card card-type-${e.kind}`;
  card.style.setProperty("--i", String(index));
  card.addEventListener("click", () => {
    trackEvent("click", `#/detail/${e.id}`, e.name);
    navigate(`#/detail/${e.id}`);
  });

  const magStr =
    e.magnitude !== null
      ? t("search.magnitude", { value: e.magnitude.toFixed(1) })
      : "";
  const sub = [
    e.constellation,
    e.catalogType ? e.catalogType.replace(/-/g, " ") : "",
  ]
    .filter(Boolean)
    .join(" \u00b7 ");

  card.innerHTML = `
    <div class="card-header">
      <span class="card-title">${escape(e.name)}</span>
      ${magStr ? `<span class="card-mag">${magStr}</span>` : ""}
    </div>
    <div class="card-brief">${escape(e.brief || sub)}</div>
    <div class="card-times" data-altaz>
      ${sub ? `<span>${escape(sub)}</span>` : ""}
    </div>
  `;

  // Hydrate alt/az lazily \u2014 only after the card is in the DOM.
  // For stars/DSOs we compute directly; planets/moon use the engine helpers.
  queueMicrotask(() => {
    void hydrateAltAz(card, e, ctx);
  });

  return card;
}

async function hydrateAltAz(
  card: HTMLElement,
  e: SearchEntry,
  ctx: AppContext,
): Promise<void> {
  const slot = card.querySelector<HTMLElement>("[data-altaz]");
  if (!slot) return;

  const now = new Date();
  let alt: number | null = null;
  let az: number | null = null;

  if (e.kind === "planet") {
    const name = e.name.toLowerCase();
    const events = getPlanetEvents(ctx.location, now).filter(
      (p) => p.name.toLowerCase() === name,
    );
    if (events.length) {
      alt = events[0].altitude;
      az = events[0].azimuth;
    }
  } else if (e.kind === "moon") {
    const moon: CelestialEvent | null = getMoonEvent(ctx.location, now);
    if (moon) {
      alt = moon.altitude;
      az = moon.azimuth;
    }
  } else if (e.ra !== null && e.dec !== null) {
    const aa = getAltAzForRaDec(e.ra, e.dec, ctx.location, now);
    alt = aa.altitude;
    az = aa.azimuth;
  }

  if (alt === null) return;
  const isUp = alt > 0;
  const sub = slot.querySelector("span")?.textContent ?? "";
  slot.innerHTML = `
    ${sub ? `<span>${escape(sub)}</span>` : ""}
    <span class="vis-dot ${isUp ? "up" : "down"}" aria-hidden="true"></span>
    <span>${escape(t("search.altValue", { value: alt.toFixed(0) }))}</span>
    ${az !== null ? `<span>${escape(t("search.azValue", { value: az.toFixed(0) }))}</span>` : ""}
  `;
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
