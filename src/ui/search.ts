import type { AppContext, CelestialEvent } from "../types.js";
import { loadDSOCatalog } from "../catalog/dso.js";
import { loadStarCatalog } from "../catalog/stars.js";
import { METEOR_SHOWERS } from "../catalog/meteors.js";
import { renderHeader, renderNav } from "./layout.js";
import { hashQuery, navigate, replaceHash } from "./router.js";
import { trackEvent, trackInsight } from "../services/analytics.js";
import { t, detectLocale } from "../i18n/translations.js";
import type { Locale } from "../i18n/translations.js";
import {
  getAltAzForRaDec,
  getPlanetEvents,
  getMoonEvent,
} from "../engine/astro.js";
import { viewTime } from "../services/sky-time.js";
import {
  dsoToEntry,
  normalizeText,
  planetEntry,
  rankMatches,
  starToEntry,
  uniq,
  type SearchEntry,
} from "../services/search-core.js";

/* ── Search index ─────────────────────────────────────────────────
 *
 * One flat array of lightweight entries, built once per session. Matching
 * and ranking live in services/search-core.ts (pure, unit-tested): exact
 * catalogue IDs and aliases first ("m 42", "ngc 292", "lmc", "pleiades"),
 * then name prefixes, word prefixes and substrings, with planets and the
 * Moon ahead of everything else in each tier.
 */

let indexCache: SearchEntry[] | null = null;
let indexBuilding: Promise<SearchEntry[]> | null = null;
let indexLocale: Locale | null = null;

async function buildIndex(): Promise<SearchEntry[]> {
  const requestedLocale = detectLocale();
  if (indexCache && indexLocale === requestedLocale) return indexCache;
  if (indexBuilding) {
    await indexBuilding;
    // A language change can happen while the catalogs are loading. Re-enter
    // after the in-flight build so the translated built-in briefs are never
    // left in the previous language for the rest of the session.
    return buildIndex();
  }
  const build = (async () => {
    const [stars, dsos] = await Promise.all([
      loadStarCatalog(),
      loadDSOCatalog(),
    ]);

    const entries: SearchEntry[] = [];
    for (const s of stars) entries.push(starToEntry(s));
    for (const d of dsos) entries.push(dsoToEntry(d));

    // Planets (always 7) — RA/Dec is location-time-dependent so we leave
    // ra/dec null here; the result card hydrates azimuth on demand from
    // getPlanetEvents using the page's location and time.
    for (const name of [
      "Mercury",
      "Venus",
      "Mars",
      "Jupiter",
      "Saturn",
      "Uranus",
      "Neptune",
    ]) {
      entries.push(
        planetEntry(name, t("search.planetBrief", undefined, requestedLocale)),
      );
    }

    // Moon
    entries.push({
      id: "moon",
      kind: "moon",
      name: "Moon",
      brief: t("search.moonBrief", undefined, requestedLocale),
      magnitude: null,
      constellation: "",
      catalogType: "moon",
      searchText: "moon luna earth satellite",
      keys: ["moon", "luna", "the moon"],
      names: ["moon", "luna"],
      text: "moon luna earth satellite",
      notable: true,
      flags: new Set(["moon"]),
      ra: null,
      dec: null,
    });

    // Meteor showers
    for (const shower of METEOR_SHOWERS) {
      const name = normalizeText(shower.name);
      entries.push({
        id: `meteor-${shower.id}`,
        kind: "meteor",
        name: shower.name,
        brief: t(
          "search.meteorBrief",
          {
            peakMonth: shower.peakMonth,
            peakDay: shower.peakDay,
            zhr: shower.zhr,
            parentBody: shower.parentBody,
          },
          requestedLocale,
        ),
        magnitude: null,
        constellation: "",
        catalogType: "meteor-shower",
        searchText: `${shower.name} ${shower.id} meteor shower ${shower.parentBody}`.toLowerCase(),
        keys: uniq([name, normalizeText(shower.id)]),
        names: [name],
        text: normalizeText(
          `${shower.name} ${shower.id} meteor shower ${shower.parentBody}`,
        ),
        notable: true,
        flags: new Set(["meteor"]),
        ra: shower.radiantRA,
        dec: shower.radiantDec,
      });
    }

    indexCache = entries;
    indexLocale = requestedLocale;
    return entries;
  })();
  indexBuilding = build;
  try {
    return await build;
  } finally {
    // A rejected import must not poison every later search attempt. The
    // identity check also avoids clearing a newer retry's promise.
    if (indexBuilding === build) indexBuilding = null;
  }
}

/**
 * The detail-route id for a name or catalogue ID ("M42", "ngc292", "lmc",
 * "jupiter", "alpha centauri"), or null. Used by `#/object/:name`.
 */
export async function resolveObjectId(nameOrId: string): Promise<string | null> {
  const entries = await buildIndex();
  const [best] = rankMatches(entries, nameOrId);
  return best?.id ?? null;
}

/* ── Chip taxonomy ─────────────────────────────────────────────── */

interface Chip {
  key: string;
  // Translation key, not display text — call t(chip.labelKey) at render
  // time so labels stay correct across a locale switch (this array is
  // built once at module load, before the user can have changed locale).
  labelKey: string;
  icon: string;
  // An entry matches the chip if any flag is set OR any keyword is found.
  flags?: string[];
  keywords?: string[];
  /** Shown before "More filters" is opened. */
  quick?: boolean;
}

const CHIPS: Chip[] = [
  // Solar system
  { key: "planet", labelKey: "search.chip.planet", icon: "🪐", flags: ["planet"], quick: true },
  { key: "moon", labelKey: "search.chip.moon", icon: "🌑", flags: ["moon"] },
  { key: "meteor", labelKey: "search.chip.meteor", icon: "🌠", flags: ["meteor"] },
  // Stars
  { key: "named-star", labelKey: "search.chip.namedStar", icon: "⭐", flags: ["star"] },
  { key: "double", labelKey: "search.chip.doubleStar", icon: "⭐⭐", flags: ["double"] },
  { key: "variable", labelKey: "search.chip.variable", icon: "💫", flags: ["variable"] },
  { key: "exoplanet-host", labelKey: "search.chip.exoplanetHost", icon: "🔭", flags: ["exoplanet-host"] },
  // Deep sky
  { key: "messier", labelKey: "search.chip.messier", icon: "M", flags: ["messier"] },
  { key: "caldwell", labelKey: "search.chip.caldwell", icon: "C", flags: ["caldwell"] },
  { key: "galaxy", labelKey: "search.chip.galaxy", icon: "🌌", flags: ["galaxy", "galaxy-pair", "galaxy-group"], quick: true },
  { key: "nebula", labelKey: "search.chip.nebula", icon: "🌫", flags: ["nebula", "emission-nebula", "reflection-nebula", "dark-nebula", "hii-region"], quick: true },
  { key: "planetary-nebula", labelKey: "search.chip.planetaryNebula", icon: "💍", flags: ["planetary-nebula"] },
  { key: "supernova-remnant", labelKey: "search.chip.supernovaRemnant", icon: "💥", flags: ["supernova-remnant"] },
  { key: "open-cluster", labelKey: "search.chip.openCluster", icon: "🌟", flags: ["open-cluster"] },
  { key: "globular-cluster", labelKey: "search.chip.globularCluster", icon: "⛪", flags: ["globular-cluster"] },
  { key: "hii-region", labelKey: "search.chip.hiiRegion", icon: "✨", flags: ["hii-region", "star-forming"] },
  // Phenomenon keywords (full-text)
  { key: "pulsar", labelKey: "search.chip.pulsar", icon: "🔆", flags: ["pulsar"], keywords: ["pulsar"] },
  { key: "black-hole", labelKey: "search.chip.blackHole", icon: "⚫", flags: ["black-hole"], keywords: ["black hole", "supermassive"] },
  { key: "quasar", labelKey: "search.chip.quasar", icon: "💠", flags: ["quasar"], keywords: ["quasar"] },
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

  // `#/search?q=nebula&chips=galaxy` opens prefilled.
  const params = hashQuery();
  const state: SearchState = {
    query: params.get("q") ?? "",
    activeChips: new Set(
      (params.get("chips") ?? "")
        .split(",")
        .filter((k) => CHIPS.some((c) => c.key === k)),
    ),
  };

  const page = document.createElement("div");
  page.className = "search-page";
  container.appendChild(page);

  // A real form so Enter (the keyboard's Search key) submits: that is the
  // one place the keyboard is dismissed on purpose.
  const form = document.createElement("form");
  form.className = "search-field";
  form.setAttribute("role", "search");
  form.noValidate = true;

  const tokens = document.createElement("span");
  tokens.className = "search-tokens";
  form.appendChild(tokens);

  const input = document.createElement("input");
  input.type = "search";
  input.className = "search-input";
  input.placeholder = t("search.inputPlaceholder");
  input.setAttribute("aria-label", t("search.inputAriaLabel"));
  input.setAttribute("enterkeyhint", "search");
  input.autocomplete = "off";
  input.autocapitalize = "off";
  input.spellcheck = false;
  input.value = state.query;
  form.appendChild(input);

  // Chip palette: three quick chips, the rest behind "More filters".
  const palette = document.createElement("div");
  palette.className = "search-palette";
  palette.setAttribute("role", "group");
  palette.setAttribute("aria-label", t("search.suggestedFiltersAriaLabel"));
  let showAllChips = CHIPS.some((c) => !c.quick && state.activeChips.has(c.key));
  for (const chip of CHIPS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "search-chip-suggest";
    btn.dataset.key = chip.key;
    if (!chip.quick) btn.dataset.more = "true";
    btn.innerHTML = `<span class="chip-icon" aria-hidden="true">${chip.icon}</span><span class="chip-label">${escape(t(chip.labelKey))}</span>`;
    btn.addEventListener("click", () => {
      if (state.activeChips.has(chip.key)) state.activeChips.delete(chip.key);
      else state.activeChips.add(chip.key);
      // No input.focus(): a chip tap is a browse, not a request to type, and
      // focusing would raise the keyboard over the results.
      void refresh();
    });
    palette.appendChild(btn);
  }
  const moreBtn = document.createElement("button");
  moreBtn.type = "button";
  moreBtn.className = "search-chip-suggest search-chip-more";
  moreBtn.addEventListener("click", () => {
    showAllChips = !showAllChips;
    paintPalette();
  });
  palette.appendChild(moreBtn);

  const hint = document.createElement("p");
  hint.className = "search-hint";
  hint.textContent = t("search.hint");
  page.appendChild(hint);
  page.appendChild(form);
  page.appendChild(palette);

  const results = document.createElement("div");
  results.className = "search-results";
  page.appendChild(results);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    input.blur();
    void refresh().then(revealFirstResult);
  });
  // While typing on a touch screen the bottom nav would sit on top of the
  // keyboard and cover the results; tuck it away until the field is left.
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const setTyping = (on: boolean): void => {
    document.body.classList.toggle("search-typing", on && coarse);
  };
  input.addEventListener("focus", () => setTyping(true));
  input.addEventListener("blur", () => setTyping(false));
  window.addEventListener("app:navigate", () => setTyping(false), { once: true });

  /** After Enter: make sure the first result is on screen. */
  function revealFirstResult(): void {
    const first = results.querySelector<HTMLElement>(".card");
    if (!first) return;
    const r = first.getBoundingClientRect();
    const vv = window.visualViewport;
    const bottom = (vv ? vv.offsetTop + vv.height : window.innerHeight) - 24;
    if (r.top > bottom || r.top < 0) {
      results.scrollIntoView({ block: "start" });
    }
  }
  // Scrolling the results means reading them: put the keyboard away.
  const dismissKeyboard = (): void => {
    if (document.activeElement === input) input.blur();
  };
  results.addEventListener("touchmove", dismissKeyboard, { passive: true });
  results.addEventListener("wheel", dismissKeyboard, { passive: true });

  function paintTokens(): void {
    tokens.innerHTML = "";
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
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        state.activeChips.delete(key);
        void refresh();
      });
      token.appendChild(remove);
      tokens.appendChild(token);
    }
  }

  function paintPalette(): void {
    palette
      .querySelectorAll<HTMLButtonElement>(".search-chip-suggest[data-key]")
      .forEach((btn) => {
        const k = btn.dataset.key ?? "";
        const active = state.activeChips.has(k);
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-pressed", active ? "true" : "false");
        btn.hidden = Boolean(btn.dataset.more) && !showAllChips && !active;
      });
    moreBtn.textContent = showAllChips
      ? t("search.fewerFilters")
      : t("search.moreFilters");
    moreBtn.setAttribute("aria-expanded", showAllChips ? "true" : "false");
  }

  /** Keep `#/search?q=…&chips=…` in the address bar for reload and share. */
  function syncUrl(): void {
    const q = new URLSearchParams();
    if (state.query) q.set("q", state.query);
    if (state.activeChips.size) q.set("chips", [...state.activeChips].join(","));
    const qs = q.toString();
    replaceHash(qs ? `#/search?${qs}` : "#/search");
  }

  let queryToken = 0;
  let searchObserved = false;
  let resultsObserved = false;
  let emptyObserved = false;
  async function refresh(): Promise<void> {
    paintTokens();
    paintPalette();
    state.query = input.value.trim();
    hint.hidden = Boolean(state.query) || state.activeChips.size > 0;
    syncUrl();

    const myToken = ++queryToken;
    if (!state.query && state.activeChips.size === 0) {
      results.innerHTML = `<p class="search-empty">${escape(t("search.emptyStatePrompt"))}</p>`;
      return;
    }

    let entries: SearchEntry[];
    if (!searchObserved) { searchObserved = true; trackInsight("search_start"); }
    try {
      entries = await buildIndex();
    } catch {
      if (myToken !== queryToken || !page.isConnected) return;
      trackInsight("search_error");
      results.innerHTML = "";
      const message = document.createElement("p");
      message.className = "search-empty";
      message.textContent = t("common.dataLoadError");
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "btn btn-outline";
      retry.textContent = t("common.tryAgain");
      retry.addEventListener("click", () => void refresh());
      results.appendChild(message);
      results.appendChild(retry);
      return;
    }
    if (myToken !== queryToken) return; // a newer keystroke superseded us
    if (!page.isConnected) return;

    const activeChips = Array.from(state.activeChips)
      .map((k) => CHIPS.find((c) => c.key === k))
      .filter((c): c is Chip => Boolean(c));
    const chipFiltered = activeChips.length
      ? entries.filter((e) => activeChips.every((chip) => entryMatchesChip(e, chip)))
      : entries;
    const matches = rankMatches(chipFiltered, state.query);

    paintResults(matches);
    // One outcome of each kind per search-screen visit; never every keystroke.
    if (matches.length && !resultsObserved) { resultsObserved = true; trackInsight("search_results"); }
    if (!matches.length && !emptyObserved) { emptyObserved = true; trackInsight("search_empty"); }
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

  input.addEventListener("input", () => {
    void refresh();
  });
  void refresh();
  // Focus only where it costs nothing: a mouse-and-keyboard screen with an
  // empty box. On touch screens the user taps the field when they want it.
  if (!state.query && window.matchMedia?.("(pointer: fine)").matches) {
    input.focus({ preventScroll: true });
  }
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
  card.setAttribute("role", "link");
  card.tabIndex = 0;
  card.setAttribute("aria-label", e.name);
  const openCard = () => {
    trackEvent("click", `#/detail/${e.id}`, e.name);
    navigate(`#/detail/${e.id}`);
  };
  card.addEventListener("click", openCard);
  card.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openCard();
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
    .join(" · ");

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

  // Hydrate alt/az lazily — only after the card is in the DOM.
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
  if (!card.isConnected) return;
  const slot = card.querySelector<HTMLElement>("[data-altaz]");
  if (!slot) return;

  const now = viewTime(ctx);
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
  if (!card.isConnected) return;
  const isUp = alt > 0;
  card.classList.toggle("is-below", !isUp);
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
