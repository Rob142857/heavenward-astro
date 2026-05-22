import type { AppContext, Equipment } from "../types.js";
import {
  runtimeCatalogSources,
  type CatalogProvenance,
} from "../catalog/provenance.js";
import { loadPrefs, savePrefs } from "../services/prefs.js";
import { renderHeader, renderNav } from "./layout.js";
import { CATEGORY_OPTIONS, EQUIPMENT_OPTIONS } from "./filterOptions.js";

export function renderSources(container: HTMLElement, ctx: AppContext): void {
  container.innerHTML = "";
  renderHeader(container, ctx);
  renderNav("#/sources");

  const title = document.createElement("h3");
  title.className = "section-title";
  title.textContent = "Settings";
  container.appendChild(title);

  const prefs = loadPrefs();

  const sourcesTitle = document.createElement("h3");
  sourcesTitle.className = "section-title";
  sourcesTitle.textContent = "Data Sources";
  container.appendChild(sourcesTitle);

  const provenanceNote = document.createElement("p");
  provenanceNote.className = "source-note";
  provenanceNote.textContent =
    "Choose what appears in Tonight. Tap the info button for a short source note; full credits live on About.";
  container.appendChild(provenanceNote);

  for (const src of runtimeCatalogSources()) {
    const row = document.createElement("div");
    row.className = "toggle-row source-row";
    row.innerHTML = `
      <div class="source-info">
        <span class="toggle-label">${src.label}</span>
        <button type="button" class="source-info-button" aria-label="About ${src.label} source">i</button>
      </div>
      <label class="toggle">
        <input type="checkbox" ${prefs.enabledSources.includes(src.key) ? "checked" : ""} data-source="${src.key}">
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

  // Magnitude limit
  const magSection = document.createElement("h3");
  magSection.className = "section-title";
  magSection.textContent = "Magnitude Limit";
  container.appendChild(magSection);

  const magRow = document.createElement("div");
  magRow.className = "toggle-row";
  magRow.innerHTML = `
    <span class="toggle-label">Show objects up to mag</span>
    <input type="number" class="input" style="width:80px" value="${prefs.magnitudeLimit}" min="1" max="15" step="0.5">
  `;
  const magInput = magRow.querySelector("input")!;
  magInput.addEventListener("change", () => {
    const current = loadPrefs();
    current.magnitudeLimit = parseFloat(magInput.value) || 6.0;
    savePrefs(current);
    ctx.prefs = current;
  });
  container.appendChild(magRow);

  // Equipment selector
  const eqSection = document.createElement("h3");
  eqSection.className = "section-title";
  eqSection.textContent = "Equipment";
  container.appendChild(eqSection);

  const eqNote = document.createElement("p");
  eqNote.className = "source-note";
  eqNote.textContent =
    "Filters objects by what's visible with your gear. Also shown on the Tonight page.";
  container.appendChild(eqNote);

  const eqPills = document.createElement("div");
  eqPills.className = "eq-pills";
  eqPills.style.marginBottom = "12px";
  const currentEq = prefs.equipment ?? "naked-eye";
  for (const eq of EQUIPMENT_OPTIONS) {
    const pill = document.createElement("button");
    pill.className = `eq-pill${currentEq === eq.key ? " active" : ""}`;
    pill.textContent = `${eq.icon} ${eq.label}`;
    pill.addEventListener("click", () => {
      const current = loadPrefs();
      current.equipment = eq.key;
      current.magnitudeLimit = eq.mag;
      savePrefs(current);
      ctx.prefs = current;
      renderSources(container, ctx);
    });
    eqPills.appendChild(pill);
  }
  container.appendChild(eqPills);

  const activeEq =
    EQUIPMENT_OPTIONS.find((e) => e.key === currentEq) ?? EQUIPMENT_OPTIONS[0];
  const eqDesc = document.createElement("p");
  eqDesc.className = "source-note";
  eqDesc.style.marginTop = "0";
  eqDesc.innerHTML = `<strong>${activeEq.icon} ${activeEq.label}</strong> — ${activeEq.desc} Magnitude limit: <strong>${activeEq.mag === 99 ? "none" : activeEq.mag.toFixed(1)}</strong>`;
  container.appendChild(eqDesc);

  const catSection = document.createElement("h3");
  catSection.className = "section-title";
  catSection.textContent = "Category Filters";
  container.appendChild(catSection);

  const catNote = document.createElement("p");
  catNote.className = "source-note";
  catNote.textContent =
    "These switches use the same saved filters as the Tonight page, so changes here apply everywhere.";
  container.appendChild(catNote);

  const enabledCategories = new Set(
    prefs.enabledCategories ?? CATEGORY_OPTIONS.map((category) => category.key),
  );
  for (const category of CATEGORY_OPTIONS) {
    const row = document.createElement("div");
    row.className = "toggle-row";
    row.innerHTML = `
      <span class="toggle-label">${category.icon} ${category.label}</span>
      <label class="toggle">
        <input type="checkbox" ${enabledCategories.has(category.key) ? "checked" : ""}>
        <span class="slider"></span>
      </label>
    `;
    const input = row.querySelector("input")!;
    input.addEventListener("change", () => {
      const current = loadPrefs();
      const currentCategories = new Set(
        current.enabledCategories ?? CATEGORY_OPTIONS.map((item) => item.key),
      );
      if (input.checked) {
        currentCategories.add(category.key);
      } else {
        currentCategories.delete(category.key);
      }
      current.enabledCategories = CATEGORY_OPTIONS.map(
        (item) => item.key,
      ).filter((key) => currentCategories.has(key));
      savePrefs(current);
      ctx.prefs = current;
    });
    container.appendChild(row);
  }
}

function showSourceModal(source: CatalogProvenance): void {
  document.querySelector(".source-modal-backdrop")?.remove();

  const backdrop = document.createElement("div");
  backdrop.className = "source-modal-backdrop";
  backdrop.innerHTML = `
    <div class="source-modal" role="dialog" aria-modal="true" aria-labelledby="source-modal-title">
      <button type="button" class="source-modal-close" aria-label="Close source note">&times;</button>
      <h3 id="source-modal-title">${source.label}</h3>
      <p>${source.summary}</p>
      <dl>
        <div><dt>Maintained by</dt><dd>${source.maintainer}</dd></div>
        <div><dt>License</dt><dd>${source.license}</dd></div>
      </dl>
      <div class="source-modal-actions">
        <a href="#/about/sources" class="source-link">Full source notes</a>
        <a href="${source.primaryUrl}" target="_blank" rel="noopener" class="source-link">Primary source</a>
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
