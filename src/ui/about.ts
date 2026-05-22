import type { AppContext } from "../types.js";
import {
  acknowledgementSources,
  expansionCatalogSources,
  type CatalogProvenance,
} from "../catalog/provenance.js";
import { renderHeader, renderNav } from "./layout.js";

export function renderAbout(container: HTMLElement, ctx: AppContext): void {
  container.innerHTML = "";
  renderHeader(container, ctx);
  renderNav("#/about");

  const content = document.createElement("div");
  content.className = "about-page";
  content.innerHTML = `
    <div class="about-hero">
      <h2 class="about-title">Heavenward</h2>
      <p class="about-tagline">Is tonight worth a warm jacket and a cup of tea?</p>
    </div>

    <div class="about-section">
      <p class="about-prose">
        Heavenward answers a simple question: what's above you right now that's worth
        setting up the telescope, dragging out the banana chair, and staying up a little
        past bedtime for? It checks your location, works out what's visible tonight, and
        tells you plainly — no star-chart puzzles, no date pickers, no fuss. Just open it
        and see what the sky has in store.
      </p>
      <p class="about-prose" style="margin-top:12px;opacity:0.85;font-size:0.95em;">
        Free and <a href="https://github.com/Rob142857/heavenward-astro" target="_blank" rel="noopener" class="wiki-link">open source</a>.
      </p>
    </div>

    <div class="about-section">
      <h3 class="about-heading">Tonight's Sky, at a Glance</h3>
      <div class="about-features">
        <div class="about-feature">
          <div class="about-feature-icon">🌙</div>
          <div>
            <strong>Planets, Moon &amp; Stars</strong>
            <p>Rise/set times, altitude, magnitude, constellation — all computed live for your GPS location.</p>
          </div>
        </div>
        <div class="about-feature">
          <div class="about-feature-icon">🌌</div>
          <div>
            <strong>Deep Sky Objects</strong>
            <p>Hundreds of galaxies, nebulae, and clusters from a curated catalog with imaging notes and surface brightness.</p>
          </div>
        </div>
        <div class="about-feature">
          <div class="about-feature-icon">☄️</div>
          <div>
            <strong>Meteor Showers</strong>
            <p>Active shower tracking with ZHR, radiant position, peak dates, and practical observing tips.</p>
          </div>
        </div>
        <div class="about-feature">
          <div class="about-feature-icon">🧭</div>
          <div>
            <strong>Sky Guide</strong>
            <p>Tap any object for compass directions, nearby objects, finder charts, and photography tips — everything you need to point your eyes or your camera.</p>
          </div>
        </div>
        <div class="about-feature">
          <div class="about-feature-icon">🤖</div>
          <div>
            <strong>AI Commentary</strong>
            <p>Optional on-device AI generates rich, conversational guides to any region of the sky — fascinating facts, observing directions, Wikipedia links, and photography advice. Runs entirely in your browser using WebGPU. No data leaves your device.</p>
          </div>
        </div>
      </div>
    </div>

    ${renderDataAcknowledgements()}

    <div class="about-section">
      <h3 class="about-heading">Privacy</h3>
      <p class="about-prose">
        Your GPS location is used only for astronomical calculations and <strong>never leaves your device</strong>.
        All ephemeris, rise/set, and visibility computations run entirely client-side — no coordinates
        are transmitted to any server, even if you sign in. The AI model also runs entirely in your
        browser via WebGPU — no cloud, no tracking, no data sent anywhere.
      </p>
    </div>

    <div class="about-section">
      <h3 class="about-heading">Source &amp; License</h3>
      <p class="about-prose">
        Heavenward is open source under the
        <a href="https://www.apache.org/licenses/LICENSE-2.0" target="_blank" rel="noopener" class="wiki-link">Apache 2.0 License</a>.
        The source code is available on
        <a href="https://github.com/Rob142857/heavenward-astro" target="_blank" rel="noopener" class="wiki-link">GitHub</a>.
        Contributions, bug reports, and feature ideas are welcome.
      </p>
    </div>

    <div class="about-section about-closing">
      <p class="about-prose about-personal">
        This is the astronomy app I always wanted but could never find — so I made it.
        I hope it helps you see more of the sky, learn something new, and feel a little
        wonder when you look up. Please enjoy. ✨
      </p>
      <p class="about-version">Heavenward v0.1.0</p>
    </div>
  `;
  container.appendChild(content);
}

function renderDataAcknowledgements(): string {
  const activeCards = acknowledgementSources()
    .map(renderAcknowledgementCard)
    .join("");
  const plannedCards = expansionCatalogSources()
    .map(renderPlannedCard)
    .join("");

  return `
    <div class="about-section">
      <h3 class="about-heading">Data Sources &amp; Acknowledgements</h3>
      <p class="about-prose">
        Heavenward stands on open science, public catalogs, careful software, and many patient observers.
        All astronomy computation runs client-side. We are grateful to the maintainers who preserve these
        datasets and especially to the observers whose nights under the sky make the records possible.
      </p>
      <div class="about-features about-provenance" style="margin-top:16px">
        ${activeCards}
      </div>
    </div>

    <div class="about-section">
      <h3 class="about-heading">Catalog Expansion Plan</h3>
      <p class="about-prose">
        The next catalog work is designed as reproducible importers with explicit licenses, transforms,
        validation checks, and attribution before anything is bundled into the app.
      </p>
      <div class="about-features about-provenance about-provenance-planned" style="margin-top:16px">
        ${plannedCards}
      </div>
    </div>
  `;
}

function renderAcknowledgementCard(source: CatalogProvenance): string {
  const links = source.upstreams
    .slice(0, 3)
    .map(
      (upstream) =>
        `<a href="${upstream.url}" target="_blank" rel="noopener" class="wiki-link">${upstream.name}</a>`,
    )
    .join(" · ");

  return `
    <div class="about-feature">
      <div class="about-feature-icon">${sourceIcon(source.key)}</div>
      <div>
        <strong><a href="${source.primaryUrl}" target="_blank" rel="noopener" class="wiki-link">${source.label}</a></strong>
        <p>${source.summary}</p>
        <p><span class="about-credit-label">Maintainers:</span> ${source.maintainer}</p>
        <p><span class="about-credit-label">License:</span> ${source.license}</p>
        <p><span class="about-credit-label">Sources:</span> ${links}</p>
        <p class="about-gratitude">${source.gratitude}</p>
      </div>
    </div>
  `;
}

function renderPlannedCard(source: CatalogProvenance): string {
  return `
    <div class="about-feature">
      <div class="about-feature-icon">${sourceIcon(source.key)}</div>
      <div>
        <strong><a href="${source.primaryUrl}" target="_blank" rel="noopener" class="wiki-link">${source.label}</a></strong>
        <p>${source.summary}</p>
        <p><span class="about-credit-label">Before bundling:</span> ${source.license}</p>
        <p class="about-gratitude">${source.gratitude}</p>
      </div>
    </div>
  `;
}

function sourceIcon(key: string): string {
  switch (key) {
    case "planets":
    case "conjunctions":
      return "🪐";
    case "moon":
    case "eclipses":
      return "🌙";
    case "stars":
    case "gaia-dr3":
    case "variable-stars":
      return "⭐";
    case "dso":
    case "simbad-vizier-ned":
      return "🌌";
    case "meteors":
      return "☄️";
    case "images":
      return "🔭";
    case "webllm":
      return "🤖";
    default:
      return "•";
  }
}
