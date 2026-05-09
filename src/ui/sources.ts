import type { AppContext, Equipment } from "../types.js";
import { loadPrefs, savePrefs } from "../services/prefs.js";
import { renderHeader, renderNav } from "./layout.js";

const SOURCES = [
  {
    key: "planets",
    label: "Planets",
    tip: `Mercury through Neptune — positions, rise/set times, elongation, and visual magnitudes computed in real time. Powered by <strong>astronomy-engine</strong> by Don Cross (MIT), which uses truncated VSOP87 planetary theory verified against JPL Horizons and NOVAS C 3.1 to ±1 arcminute accuracy. No network calls — all computation happens on your device.`,
    url: "https://github.com/cosinekitty/astronomy",
  },
  {
    key: "moon",
    label: "Moon",
    tip: `Lunar position, phase name, illumination percentage, rise/set/transit times, and libration. Also powered by <strong>astronomy-engine</strong> using ELP/MPP02 lunar theory. Phase angle is calculated from Sun–Moon–Earth geometry to show the exact illuminated fraction at your location.`,
    url: "https://github.com/cosinekitty/astronomy",
  },
  {
    key: "stars",
    label: "Stars",
    tip: `Named and navigational stars with spectral types, magnitudes, colour indices, and double/variable flags. Our catalog is compiled from the <strong>Yale Bright Star Catalogue, 5th Revised Edition</strong> (Hoffleit &amp; Warren, 1991, V/50) — the standard reference for stars brighter than mag 6.5 — cross-referenced with <strong>IAU official star names</strong> (2024 revision). Hosted and maintained by NASA's HEASARC at Goddard Space Flight Center.`,
    url: "https://heasarc.gsfc.nasa.gov/W3Browse/star-catalog/bsc5p.html",
  },
  {
    key: "dso",
    label: "Deep Sky Objects",
    tip: `Galaxies, nebulae, and star clusters with magnitudes, angular sizes, surface brightness, and morphology. Our curated catalog includes all 110 <strong>Messier objects</strong> (Charles Messier, 1774–1781), the 109 <strong>Caldwell objects</strong> (Sir Patrick Moore, 1995), and select NGC/IC highlights. Physical data cross-referenced with the <strong>NGC/IC Project</strong> (Dr. Harold Corwin) and <strong>CDS VizieR</strong> at Strasbourg Astronomical Data Centre.`,
    url: "https://en.wikipedia.org/wiki/Messier_object",
  },
  {
    key: "meteors",
    label: "Meteor Showers",
    tip: `Active shower detection with zenithal hourly rates (ZHR), geocentric velocities, radiant RA/Dec coordinates, and parent body identification. Data compiled from the <strong>IAU Meteor Data Center</strong> working list and the <strong>International Meteor Organization</strong> (IMO) annual calendar. Includes all established showers (Quadrantids, Perseids, Geminids, etc.) with activity windows verified against multi-year observational records.`,
    url: "https://www.imo.net/resources/meteor-shower-calendar/",
  },
  {
    key: "eclipses",
    label: "Eclipses",
    tip: `Solar and lunar eclipse predictions including type (total, partial, annular, penumbral), peak time, and magnitude. Computed by <strong>astronomy-engine</strong>'s Besselian element algorithms, which search forward through time for eclipse geometry. Accuracy verified against NASA's Five Millennium Canon of Eclipses (Espenak &amp; Meeus).`,
    url: "https://github.com/cosinekitty/astronomy",
  },
  {
    key: "conjunctions",
    label: "Conjunctions",
    tip: `Close approaches between planets and the Moon, detected by scanning angular separations in real time. <strong>astronomy-engine</strong> calculates precise geocentric and topocentric positions for each body pair and reports the minimum separation and timing. Includes planet–planet, planet–Moon, and planet–star conjunctions.`,
    url: "https://github.com/cosinekitty/astronomy",
  },
];

export function renderSources(container: HTMLElement, ctx: AppContext): void {
  container.innerHTML = "";
  renderHeader(container, ctx);
  renderNav("#/sources");

  const title = document.createElement("h3");
  title.className = "section-title";
  title.textContent = "Data Sources";
  container.appendChild(title);

  const prefs = loadPrefs();

  for (const src of SOURCES) {
    const row = document.createElement("div");
    row.className = "toggle-row source-row";
    row.innerHTML = `
      <div class="source-info">
        <span class="toggle-label">${src.label}</span>
        <div class="source-tooltip">
          <p>${src.tip}</p>
          <a href="${src.url}" target="_blank" rel="noopener" class="source-link">Learn more ↗</a>
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
  eqNote.textContent = "Filters objects by what's visible with your gear. Also shown on the Tonight page.";
  container.appendChild(eqNote);

  const EQUIPMENT_DEFS: { key: Equipment; label: string; icon: string; mag: number; desc: string }[] = [
    { key: "naked-eye", label: "Naked Eye", icon: "👁", mag: 6.0, desc: "Objects visible without any optical aid — bright planets, the Moon, named stars, and a handful of the brightest deep-sky showpieces like the Pleiades and Andromeda Galaxy." },
    { key: "binoculars", label: "Binoculars", icon: "🔭", mag: 10.0, desc: "A good pair of 7×50 or 10×50 binoculars opens up hundreds of star clusters, bright nebulae, and nearby galaxies down to about magnitude 10." },
    { key: "telescope", label: "Telescope", icon: "🔬", mag: 13.0, desc: "A 4–8 inch telescope reveals spiral arms in galaxies, planetary nebula detail, globular cluster resolution, and faint comets down to about magnitude 13." },
    { key: "deep-scope", label: "Deep Scope", icon: "🛰", mag: 99, desc: "Large aperture or long-exposure imaging — show everything in the catalog regardless of magnitude. No brightness filter applied." },
  ];

  const eqPills = document.createElement("div");
  eqPills.className = "eq-pills";
  eqPills.style.marginBottom = "12px";
  const currentEq = prefs.equipment ?? "naked-eye";
  for (const eq of EQUIPMENT_DEFS) {
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

  const activeEq = EQUIPMENT_DEFS.find((e) => e.key === currentEq) ?? EQUIPMENT_DEFS[0];
  const eqDesc = document.createElement("p");
  eqDesc.className = "source-note";
  eqDesc.style.marginTop = "0";
  eqDesc.innerHTML = `<strong>${activeEq.icon} ${activeEq.label}</strong> — ${activeEq.desc} Magnitude limit: <strong>${activeEq.mag === 99 ? "none" : activeEq.mag.toFixed(1)}</strong>`;
  container.appendChild(eqDesc);
}
