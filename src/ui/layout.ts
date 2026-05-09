import type { GeoLocation, AppContext } from "../types.js";
import { navigate } from "./router.js";

/* ── Seba hieroglyph SVG (animated gold shimmer) ──── */
const SEBA_SVG = `<svg class="seba-logo" viewBox="0 0 100 100" width="38" height="38" aria-hidden="true">
  <defs>
    <linearGradient id="seba-grad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#c5a44e">
        <animate attributeName="stop-color" values="#c5a44e;#f5e6a3;#c5a44e" dur="4s" repeatCount="indefinite"/>
      </stop>
      <stop offset="50%" stop-color="#f5e6a3">
        <animate attributeName="stop-color" values="#f5e6a3;#d4af37;#f5e6a3" dur="4s" repeatCount="indefinite"/>
      </stop>
      <stop offset="100%" stop-color="#d4af37">
        <animate attributeName="stop-color" values="#d4af37;#f5e6a3;#d4af37" dur="4s" repeatCount="indefinite"/>
      </stop>
    </linearGradient>
  </defs>
  <g transform="translate(50,50)" fill="url(#seba-grad)">
    <circle r="4.5"/>
    <path d="M0,-7Q-3.5,-22 0,-44Q3.5,-22 0,-7Z"/>
    <path d="M0,-7Q-3.5,-22 0,-44Q3.5,-22 0,-7Z" transform="rotate(72)"/>
    <path d="M0,-7Q-3.5,-22 0,-44Q3.5,-22 0,-7Z" transform="rotate(144)"/>
    <path d="M0,-7Q-3.5,-22 0,-44Q3.5,-22 0,-7Z" transform="rotate(216)"/>
    <path d="M0,-7Q-3.5,-22 0,-44Q3.5,-22 0,-7Z" transform="rotate(288)"/>
  </g>
</svg>`;

/* ── SVG nav icons ───────────────────────────────────── */
const NAV_ITEMS = [
  {
    hash: "#/",
    label: "Tonight",
    icon: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1l2.5 7.5h7.9l-6.4 4.6 2.4 7.5-6.4-4.7-6.4 4.7 2.4-7.5L2 8.5h7.9z"/></svg>`,
  },
  {
    hash: "#/sources",
    label: "Sources",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="10" y1="18" x2="14" y2="18"/></svg>`,
  },
  {
    hash: "#/location",
    label: "Location",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 0 0-8 8c0 5 8 12 8 12s8-7 8-12a8 8 0 0 0-8-8z"/></svg>`,
  },
  {
    hash: "#/account",
    label: "Account",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M5 21c0-4 3-7 7-7s7 3 7 7"/></svg>`,
  },
  {
    hash: "#/about",
    label: "About",
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><circle cx="12" cy="8" r="0.5" fill="currentColor"/></svg>`,
  },
];

export function renderHeader(container: HTMLElement, ctx: AppContext): void {
  const header = document.createElement("header");
  header.className = "header";

  const logoContainer = document.createElement("div");
  logoContainer.className = "logo-container";
  logoContainer.innerHTML = `${SEBA_SVG}<span class="logo-text">Heavenward</span>`;

  const loc = document.createElement("span");
  loc.className = "location-pill";
  loc.textContent = formatLocation(ctx.location);
  loc.addEventListener("click", () => navigate("#/location"));

  header.appendChild(logoContainer);
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
  nav.innerHTML = NAV_ITEMS.map(
    (item) =>
      `<a href="${item.hash}" class="${active === item.hash ? "active" : ""}">
        <span class="nav-icon">${item.icon}</span>
        <span class="nav-label">${item.label}</span>
      </a>`,
  ).join("");
}

function formatLocation(loc: GeoLocation): string {
  const lat = Math.abs(loc.lat).toFixed(2) + (loc.lat >= 0 ? "°N" : "°S");
  const lon = Math.abs(loc.lon).toFixed(2) + (loc.lon >= 0 ? "°E" : "°W");
  return `${lat}, ${lon}`;
}
