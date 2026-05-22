import type { AppContext, Equipment } from "../types.js";
import {
  expansionCatalogSources,
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
    "Each source lists its maintainers, license notes, transform path, and thanks to the observers behind the data.";
  container.appendChild(provenanceNote);

  for (const src of runtimeCatalogSources()) {
    const row = document.createElement("div");
    row.className = "toggle-row source-row";
    row.innerHTML = `
      <div class="source-info">
        <span class="toggle-label">${src.label}</span>
        <div class="source-tooltip">
          ${sourceTooltip(src)}
        </div>
      </div>
      <label class="toggle">
        <input type="checkbox" ${prefs.enabledSources.includes(src.key) ? "checked" : ""} data-source="${src.key}">
        <span class="slider"></span>
      </label>
    `;
    const input = row.querySelector("input")!;
    const info = row.querySelector(".source-info")!;
    info.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).tagName === "A") return;
      row.classList.toggle("expanded");
    });
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

  renderCatalogPipeline(container);

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

function renderCatalogPipeline(container: HTMLElement): void {
  const section = document.createElement("h3");
  section.className = "section-title";
  section.textContent = "Catalog Import Pipeline";
  container.appendChild(section);

  const note = document.createElement("p");
  note.className = "source-note";
  note.textContent =
    "Scripted imports are reproducible from npm run refresh. Manual reviews and planned datasets are documented here so licensing and attribution stay visible.";
  container.appendChild(note);

  const grid = document.createElement("div");
  grid.className = "provenance-grid";
  const pipelineSources = [
    ...runtimeCatalogSources().filter((source) => source.importJob),
    ...expansionCatalogSources(),
  ];

  for (const source of pipelineSources) {
    const card = document.createElement("div");
    card.className = "provenance-card";
    card.innerHTML = `
      <div class="provenance-card-head">
        <strong>${source.label}</strong>
        <span>${statusLabel(source.status)}</span>
      </div>
      <p>${source.summary}</p>
      <dl>
        <div><dt>Output</dt><dd>${source.output}</dd></div>
        <div><dt>Mode</dt><dd>${source.importJob ? modeLabel(source.importJob.mode) : "Planned"}</dd></div>
        <div><dt>License</dt><dd>${source.license}</dd></div>
        <div><dt>Command</dt><dd>${source.importJob ? source.importJob.command : "Planned importer"}</dd></div>
      </dl>
      <a href="${source.primaryUrl}" target="_blank" rel="noopener" class="source-link">Primary source</a>
    `;
    grid.appendChild(card);
  }

  container.appendChild(grid);
}

function sourceTooltip(source: CatalogProvenance): string {
  const upstreams = source.upstreams
    .slice(0, 3)
    .map(
      (upstream) =>
        `<li><a href="${upstream.url}" target="_blank" rel="noopener" class="source-link">${upstream.name}</a> - ${upstream.role}</li>`,
    )
    .join("");

  return `
    <p>${source.summary}</p>
    <p><strong>Maintained by:</strong> ${source.maintainer}</p>
    <p><strong>License:</strong> ${source.license}</p>
    <p><strong>Output:</strong> ${source.output}</p>
    ${source.importJob ? `<p><strong>Import:</strong> ${source.importJob.command}</p>` : ""}
    <ul class="source-upstream-list">${upstreams}</ul>
    <p class="source-thanks">${source.gratitude}</p>
    <a href="${source.primaryUrl}" target="_blank" rel="noopener" class="source-link">Primary source</a>
  `;
}

function statusLabel(status: CatalogProvenance["status"]): string {
  switch (status) {
    case "active":
      return "Active";
    case "planned":
      return "Planned";
    case "reference":
      return "Reference";
  }
}

function modeLabel(
  mode: NonNullable<CatalogProvenance["importJob"]>["mode"],
): string {
  switch (mode) {
    case "scripted":
      return "Scripted refresh";
    case "manual":
      return "Manual review";
    case "planned":
      return "Planned importer";
  }
}
