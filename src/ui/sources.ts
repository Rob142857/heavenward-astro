// UI renderers for "Sources" route (includes Settings UI)

import type { AppContext } from "../types.js";
import {
  runtimeCatalogSources,
  type CatalogProvenance,
} from "../catalog/provenance.js";
import { loadPrefs, savePrefs } from "../services/prefs.js";
import { renderHeader, renderNav } from "./layout.js";
import { t, LOCALES, type Locale } from "../i18n/translations.js";
import { setUILocale, getLocale } from "../i18n/i18n.js";
import {
  getAIQuality,
  isAIQualityAutomatic,
  isGemma4Available,
  setAIQuality,
  type AIQuality,
} from "../services/llm.js";

// Of the sources with enabledSource: true in provenance.ts, only these keys
// actually gate anything in tonight.ts's event collection today (eclipses/
// conjunctions/aurora aren't wired into the pipeline yet) — showing a toggle
// for a source that silently does nothing would be exactly the kind of
// ambiguity this settings page exists to avoid.
const WIRED_SOURCE_KEYS = new Set(["planets", "moon", "stars", "dso", "meteors"]);

export function renderSources(container: HTMLElement, ctx: AppContext): void {
  container.innerHTML = "";
  renderHeader(container, ctx);
  renderNav("#/sources");

  const title = document.createElement("h3");
  title.className = "section-title";
  title.textContent = t("nav.settings");
  container.appendChild(title);

  const prefs = loadPrefs();

  // ── Language ──────────────────────────────────────────────
  const langSection = document.createElement("h3");
  langSection.className = "section-title";
  langSection.textContent = t("settings.language.heading");
  container.appendChild(langSection);

  const langPills = document.createElement("div");
  langPills.className = "ctrl-pill-row";
  langPills.style.marginBottom = "12px";
  const currentLocale = getLocale();
  for (const loc of LOCALES) {
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = `ctrl-pill${loc.code === currentLocale ? " active" : ""}`;
    pill.textContent = loc.nativeLabel;
    pill.setAttribute("lang", loc.code);
    pill.addEventListener("click", async () => {
      if (loc.code === getLocale()) return;
      await setUILocale(loc.code as Locale);
      renderSources(container, ctx);
    });
    langPills.appendChild(pill);
  }
  container.appendChild(langPills);

  // ── AI model quality ──────────────────────────────────────
  // Only offered where the Gemma 4 runtime can actually run; on devices
  // without WebGPU the choice would be a promise we can't keep.
  if (isGemma4Available()) {
    const aiTitle = document.createElement("h3");
    aiTitle.className = "section-title";
    aiTitle.textContent = t("settings.aiQuality.heading");
    container.appendChild(aiTitle);

    const aiNote = document.createElement("p");
    aiNote.className = "source-note";
    // Say plainly when the highlighted pill reflects our guess rather than
    // their decision — otherwise the UI implies a choice they never made.
    aiNote.textContent = isAIQualityAutomatic()
      ? `${t("settings.aiQuality.note")} ${t("settings.aiQuality.autoNote")}`
      : t("settings.aiQuality.note");
    container.appendChild(aiNote);

    const aiPills = document.createElement("div");
    aiPills.className = "ctrl-pill-row";
    aiPills.style.marginBottom = "12px";
    const currentQuality = getAIQuality();
    const options: { key: AIQuality; labelKey: string }[] = [
      { key: "standard", labelKey: "settings.aiQuality.standard" },
      { key: "best", labelKey: "settings.aiQuality.best" },
    ];
    for (const opt of options) {
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = `ctrl-pill${opt.key === currentQuality ? " active" : ""}`;
      pill.textContent = t(opt.labelKey);
      pill.addEventListener("click", () => {
        if (opt.key === getAIQuality()) return;
        setAIQuality(opt.key);
        renderSources(container, ctx);
      });
      aiPills.appendChild(pill);
    }
    container.appendChild(aiPills);
  }

  // ── Data sources ──────────────────────────────────────────
  const sourcesTitle = document.createElement("h3");
  sourcesTitle.className = "section-title";
  sourcesTitle.textContent = t("settings.dataSources.heading");
  container.appendChild(sourcesTitle);

  const provenanceNote = document.createElement("p");
  provenanceNote.className = "source-note";
  provenanceNote.textContent = t("settings.dataSources.note");
  container.appendChild(provenanceNote);

  for (const src of runtimeCatalogSources().filter((s) =>
    WIRED_SOURCE_KEYS.has(s.key),
  )) {
    const row = document.createElement("div");
    row.className = "toggle-row source-row";
    row.innerHTML = `
      <div class="source-info">
        <span class="toggle-label">${src.label}</span>
        <button type="button" class="source-info-button" aria-label="${t("settings.dataSources.infoAriaLabel", { label: src.label })}">i</button>
      </div>
      <label class="toggle">
        <input type="checkbox" aria-label="${src.label}" ${prefs.enabledSources.includes(src.key) ? "checked" : ""} data-source="${src.key}">
        <span class="slider"></span>
      </label>
    `;
    const input = row.querySelector("input")!;
    const infoButton = row.querySelector<HTMLButtonElement>(
      ".source-info-button",
    )!;
    infoButton.addEventListener("click", () => showSourceModal(src));
    input.addEventListener("change", () => {
      const current = loadPrefs();
      if (input.checked) {
        if (!current.enabledSources.includes(src.key)) {
          current.enabledSources.push(src.key);
        }
      } else {
        current.enabledSources = current.enabledSources.filter(
          (s) => s !== src.key,
        );
      }
      savePrefs(current);
      ctx.prefs = current;
    });
    container.appendChild(row);
  }

  // ── Magnitude limit ───────────────────────────────────────
  const magSection = document.createElement("h3");
  magSection.className = "section-title";
  magSection.textContent = t("settings.magnitudeLimit.heading");
  container.appendChild(magSection);

  const magRow = document.createElement("div");
  magRow.className = "toggle-row";
  magRow.innerHTML = `
    <span class="toggle-label">${t("settings.magnitudeLimit.label")}</span>
    <input type="number" class="input" aria-label="${t("settings.magnitudeLimit.label")}" style="width:80px" value="${prefs.magnitudeLimit}" min="1" max="15" step="0.5">
  `;
  const magInput = magRow.querySelector("input")!;
  magInput.addEventListener("change", () => {
    const current = loadPrefs();
    current.magnitudeLimit = parseFloat(magInput.value) || 6.0;
    savePrefs(current);
    ctx.prefs = current;
  });
  container.appendChild(magRow);

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = t("settings.appVersion", { version: __APP_VERSION__ });
  container.appendChild(hint);

  // Privacy pointed at /about/terms and Terms at /about/privacy — crossed,
  // and both were absolute URLs to routes that do not exist, so either one
  // left the app entirely and landed the user back on Tonight. Privacy now
  // links in-app to About, which actually contains the privacy section.
  // Terms is dropped rather than linked to nothing: there is no terms
  // document to link to, and a link that goes nowhere is worse than no link.
  container.appendChild(createLink(t("settings.privacy"), "#/about"));
  container.appendChild(
    createLink("GitHub", "https://github.com/Rob142857/heavenward"),
  );
}

function createLink(text: string, href: string): HTMLElement {
  const a = document.createElement("a");
  a.className = "settings-link";
  a.href = href;
  // In-app hash routes must stay in this tab; only genuinely external
  // destinations get a new one.
  if (!href.startsWith("#")) {
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  }
  a.textContent = text;
  return a;
}

function showSourceModal(source: CatalogProvenance): void {
  document.querySelector(".source-modal-backdrop")?.remove();

  const backdrop = document.createElement("div");
  backdrop.className = "source-modal-backdrop";
  backdrop.innerHTML = `
    <div class="source-modal" role="dialog" aria-modal="true" aria-labelledby="source-modal-title">
      <button type="button" class="source-modal-close" aria-label="${t("settings.sourceModal.closeAriaLabel")}">&times;</button>
      <h3 id="source-modal-title">${source.label}</h3>
      <p>${source.summary}</p>
      <dl>
        <div><dt>${t("settings.sourceModal.maintainedBy")}</dt><dd>${source.maintainer}</dd></div>
        <div><dt>${t("settings.sourceModal.license")}</dt><dd>${source.license}</dd></div>
      </dl>
      <div class="source-modal-actions">
        <a href="#/about/sources" class="source-link">${t("settings.sourceModal.fullSourceNotes")}</a>
        <a href="${source.primaryUrl}" target="_blank" rel="noopener" class="source-link">${t("settings.sourceModal.primarySource")}</a>
      </div>
    </div>
  `;

  const close = () => {
    document.removeEventListener("keydown", onKeydown);
    backdrop.remove();
  };
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
  };

  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });
  backdrop
    .querySelector<HTMLButtonElement>(".source-modal-close")
    ?.addEventListener("click", close);
  backdrop.querySelectorAll<HTMLAnchorElement>("a").forEach((link) => {
    link.addEventListener("click", close);
  });
  document.addEventListener("keydown", onKeydown);
  document.body.appendChild(backdrop);
  backdrop.querySelector<HTMLButtonElement>(".source-modal-close")?.focus();
}
