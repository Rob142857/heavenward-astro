import type { AppContext } from "../types.js";
import { requestGPS, saveLocation } from "../services/geolocation.js";
import { renderHeader, renderNav } from "./layout.js";
import { navigate } from "./router.js";
import { t } from "../i18n/translations.js";

export function renderLocation(container: HTMLElement, ctx: AppContext): void {
  container.innerHTML = "";
  renderHeader(container, ctx);
  renderNav("#/location");

  const title = document.createElement("h3");
  title.className = "section-title";
  title.textContent = t("nav.location");
  container.appendChild(title);

  // GPS button
  const gpsBtn = document.createElement("button");
  gpsBtn.className = "btn btn-primary btn-block";
  gpsBtn.textContent = t("location.useGPS");
  gpsBtn.addEventListener("click", async () => {
    gpsBtn.textContent = t("location.locating");
    gpsBtn.disabled = true;
    try {
      const loc = await requestGPS();
      ctx.location = loc;
      navigate("#/");
    } catch {
      gpsBtn.textContent = t("location.gpsFailed");
      gpsBtn.disabled = false;
    }
  });
  container.appendChild(gpsBtn);

  // Manual entry
  const manualSection = document.createElement("h3");
  manualSection.className = "section-title";
  manualSection.textContent = t("location.manualEntry");
  container.appendChild(manualSection);

  const form = document.createElement("form");
  form.noValidate = false;
  form.style.display = "flex";
  form.style.flexDirection = "column";
  form.style.gap = "8px";
  form.innerHTML = `
    <label class="ctrl-label" for="lat">${t("location.latitude")}</label>
    <input class="input" type="number" id="lat" name="latitude" value="${ctx.location.lat}" step="0.01" min="-90" max="90" inputmode="decimal" required>
    <label class="ctrl-label" for="lon">${t("location.longitude")}</label>
    <input class="input" type="number" id="lon" name="longitude" value="${ctx.location.lon}" step="0.01" min="-180" max="180" inputmode="decimal" required>
    <label class="ctrl-label" for="elev">${t("location.elevation")}</label>
    <input class="input" type="number" id="elev" name="elevation" value="${ctx.location.elev}" step="1" min="-500" max="9000" inputmode="decimal">
    <button type="submit" class="btn btn-outline btn-block" id="save-loc">${t("location.save")}</button>
  `;
  container.appendChild(form);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const lat = parseFloat(
      (form.querySelector("#lat") as HTMLInputElement).value,
    );
    const lon = parseFloat(
      (form.querySelector("#lon") as HTMLInputElement).value,
    );
    const elev =
      parseFloat((form.querySelector("#elev") as HTMLInputElement).value) || 0;
    if (
      isNaN(lat) ||
      isNaN(lon) ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180
    )
      return;
    const loc = { lat, lon, elev };
    saveLocation(loc);
    ctx.location = loc;
    navigate("#/");
  });
}
