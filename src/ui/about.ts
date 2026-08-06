import type { AppContext } from "../types.js";
import {
  acknowledgementSources,
  type CatalogProvenance,
} from "../catalog/provenance.js";
import { renderHeader, renderNav, SEBA_SVG } from "./layout.js";
import { t } from "../i18n/translations.js";

export function renderAbout(
  container: HTMLElement,
  ctx: AppContext,
  focusSection?: "sources",
): void {
  container.innerHTML = "";
  renderHeader(container, ctx);
  renderNav("#/about");

  const content = document.createElement("div");
  content.className = "about-page";
  content.innerHTML = `
    <div class="about-hero">
      <div class="about-wordmark">${SEBA_SVG}<span class="logo-text">Heavenward</span></div>
      <figure class="about-quote">
        <blockquote>
          <p>${t("about.quote.text")}</p>
        </blockquote>
        <figcaption>${t("about.quote.attribution")}</figcaption>
      </figure>
    </div>

    <div class="about-section">
      <p class="about-prose">
        ${t("about.intro.description")}
      </p>
      <p class="about-prose" style="margin-top:12px;opacity:0.85;font-size:0.95em;">
        ${t("about.intro.openSource", { link: `<a href="https://github.com/Rob142857/heavenward-astro" target="_blank" rel="noopener" class="wiki-link">${t("about.intro.openSourceLinkText")}</a>` })}
      </p>
    </div>

    <div class="about-section">
      <h3 class="about-heading">${t("about.features.heading")}</h3>
      <div class="about-features">
        <div class="about-feature">
          <div class="about-feature-icon">🌙</div>
          <div>
            <strong>${t("about.features.planets.title")}</strong>
            <p>${t("about.features.planets.body")}</p>
          </div>
        </div>
        <div class="about-feature">
          <div class="about-feature-icon">🌌</div>
          <div>
            <strong>${t("about.features.deepSky.title")}</strong>
            <p>${t("about.features.deepSky.body")}</p>
          </div>
        </div>
        <div class="about-feature">
          <div class="about-feature-icon">☄️</div>
          <div>
            <strong>${t("about.features.meteors.title")}</strong>
            <p>${t("about.features.meteors.body")}</p>
          </div>
        </div>
        <div class="about-feature">
          <div class="about-feature-icon">🧭</div>
          <div>
            <strong>${t("about.features.skyGuide.title")}</strong>
            <p>${t("about.features.skyGuide.body")}</p>
          </div>
        </div>
        <div class="about-feature">
          <div class="about-feature-icon">🤖</div>
          <div>
            <strong>${t("about.features.aiCommentary.title")}</strong>
            <p>${t("about.features.aiCommentary.body")}</p>
          </div>
        </div>
      </div>
    </div>

    ${renderDataAcknowledgements()}

    <div class="about-section">
      <h3 class="about-heading">${t("about.privacy.heading")}</h3>
      <p class="about-prose">
        ${t("about.privacy.description")}
      </p>
    </div>

    <div class="about-section">
      <h3 class="about-heading">${t("about.license.heading")}</h3>
      <p class="about-prose">
        ${t("about.license.description", {
          apacheLink: `<a href="https://www.apache.org/licenses/LICENSE-2.0" target="_blank" rel="noopener" class="wiki-link">${t("about.license.apacheLinkText")}</a>`,
          githubLink: `<a href="https://github.com/Rob142857/heavenward-astro" target="_blank" rel="noopener" class="wiki-link">${t("about.license.githubLinkText")}</a>`,
        })}
      </p>
    </div>

    <div class="about-section about-closing">
      <p class="about-prose about-personal">
        ${t("about.closing.message")}
      </p>
      <p class="about-version" aria-label="${t("about.version.ariaLabel")}">${t("about.version.label", { version: __APP_VERSION__, build: __APP_BUILD__ })}</p>
    </div>
  `;
  container.appendChild(content);

  if (focusSection === "sources") {
    requestAnimationFrame(() => {
      document.getElementById("about-sources")?.scrollIntoView({
        block: "start",
      });
    });
  }
}

function renderDataAcknowledgements(): string {
  const cards = acknowledgementSources()
    .map(renderAcknowledgementCard)
    .join("");

  return `
    <div class="about-section" id="about-sources">
      <h3 class="about-heading">${t("about.sources.heading")}</h3>
      <p class="about-prose">
        ${t("about.sources.intro")}
      </p>
      <div class="about-features about-provenance" style="margin-top:16px">
        ${cards}
      </div>
    </div>
  `;
}

function renderAcknowledgementCard(source: CatalogProvenance): string {
  return `
    <div class="about-feature">
      <div class="about-feature-icon">${sourceIcon(source.key)}</div>
      <div>
        <strong><a href="${source.primaryUrl}" target="_blank" rel="noopener" class="wiki-link">${source.label}</a></strong>
        <p>${source.summary}</p>
      </div>
    </div>
  `;
}

function sourceIcon(key: string): string {
  switch (key) {
    case "planets":
    case "conjunctions":
    case "usgs-nomenclature":
      return "🪐";
    case "moon":
    case "eclipses":
      return "🌙";
    case "stars":
    case "gaia-dr3":
    case "variable-stars":
    case "iau-star-names":
    case "double-stars":
    case "exoplanets":
    case "atnf-pulsars":
      return "⭐";
    case "dso":
    case "simbad-vizier-ned":
    case "bright-nebulae":
    case "constellations":
      return "🌌";
    case "meteors":
    case "mpc-comets":
      return "☄️";
    case "celestrak-satellites":
      return "🛰️";
    case "images":
      return "🔭";
    case "webllm":
      return "🤖";
    default:
      return "•";
  }
}
