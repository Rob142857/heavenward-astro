import type { GeoLocation, AppContext } from "../types.js";
import { navigate } from "./router.js";

export function renderHeader(container: HTMLElement, ctx: AppContext): void {
  const header = document.createElement("header");
  header.className = "header";

  const title = document.createElement("h1");
  title.textContent = "☆ Heavenward";

  const loc = document.createElement("span");
  loc.className = "location";
  loc.textContent = formatLocation(ctx.location);
  loc.addEventListener("click", () => navigate("#/location"));

  header.appendChild(title);
  header.appendChild(loc);
  container.insertBefore(header, container.firstChild);
}

export function renderNav(active: string): void {
  let nav = document.querySelector(".nav");
  if (!nav) {
    nav = document.createElement("nav");
    nav.className = "nav";
    document.body.appendChild(nav);
  }
  nav.innerHTML = [
    { hash: "#/", label: "Tonight", icon: "🌙" },
    { hash: "#/sources", label: "Sources", icon: "⚙" },
    { hash: "#/location", label: "Location", icon: "📍" },
    { hash: "#/account", label: "Account", icon: "👤" },
  ]
    .map(
      (item) =>
        `<a href="${item.hash}" class="${active === item.hash ? "active" : ""}">
          <span class="icon">${item.icon}</span>${item.label}
        </a>`,
    )
    .join("");
}

function formatLocation(loc: GeoLocation): string {
  const lat = Math.abs(loc.lat).toFixed(2) + (loc.lat >= 0 ? "°N" : "°S");
  const lon = Math.abs(loc.lon).toFixed(2) + (loc.lon >= 0 ? "°E" : "°W");
  return `${lat}, ${lon}`;
}
