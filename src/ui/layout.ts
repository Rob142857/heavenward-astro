import type { GeoLocation, AppContext } from "../types.js";
import { navigate } from "./router.js";
import { bindInstallPrompt } from "../services/pwa.js";
import { openObservationsModal } from "./observations.js";

let currentCtx: AppContext | null = null;

const SHARE_URL = "https://sky.incitat.io/about";
const SHARE_TITLE = "Heavenward";
const SHARE_TEXT =
  "Heavenward shows what is worth seeing in tonight's sky, right where you are.";
const SHARE_COPY = `${SHARE_TEXT}\n${SHARE_URL}`;
const DESK_EMAIL = "desk@incitat.io";

const FEEDBACK_MAILTO = buildMailto(
  "Heavenward feedback",
  `Hello team at the desk,

I have a question or feedback about Heavenward. Any questions and feedback are responded to and appreciated.

My note:
`,
);

const SUPPORT_MAILTO = buildMailto(
  "Heavenward support request",
  `Hello team at the desk,

I need support with Heavenward.

What happened:

Device and browser:
`,
);

const FACEBOOK_SHARE_URL = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(SHARE_URL)}&quote=${encodeURIComponent(SHARE_TEXT)}`;
const SMS_SHARE_URL = `sms:?&body=${encodeURIComponent(SHARE_COPY)}`;

/* ── Seba hieroglyph SVG (animated gold shimmer) ──── */
export const SEBA_SVG = `<svg class="seba-logo" viewBox="0 0 100 100" width="38" height="38" aria-hidden="true">
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
    label: "Settings",
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
];

export function renderHeader(container: HTMLElement, ctx: AppContext): void {
  currentCtx = ctx;
  const header = document.createElement("header");
  header.className = "header";

  const logoContainer = document.createElement("div");
  logoContainer.className = "logo-container";
  logoContainer.innerHTML = `${SEBA_SVG}<span class="logo-text">Heavenward</span>`;

  const loc = document.createElement("span");
  loc.className = "location-pill";
  loc.textContent = formatLocation(ctx.location);
  loc.addEventListener("click", () => navigate("#/location"));

  const actions = document.createElement("div");
  actions.className = "header-actions";
  actions.appendChild(loc);
  actions.appendChild(renderStuffMenu());

  header.appendChild(logoContainer);
  header.appendChild(actions);
  container.insertBefore(header, container.firstChild);
  container.insertBefore(renderInstallPrompt(), header.nextSibling);
}

function renderInstallPrompt(): HTMLElement {
  const prompt = document.createElement("div");
  prompt.className = "install-prompt";
  prompt.hidden = true;
  prompt.innerHTML = `
    <div class="install-prompt-copy">
      <strong>Install Heavenward</strong>
      <span>Keep tonight's sky one tap away.</span>
    </div>
    <div class="install-prompt-actions">
      <button type="button" class="install-prompt-dismiss">Not now</button>
      <button type="button" class="install-prompt-action">Install</button>
    </div>
  `;
  const install = prompt.querySelector<HTMLButtonElement>(
    ".install-prompt-action",
  );
  const dismiss = prompt.querySelector<HTMLButtonElement>(
    ".install-prompt-dismiss",
  );
  if (install && dismiss) {
    bindInstallPrompt(prompt, install, dismiss);
  }

  return prompt;
}

export function renderNav(active: string): void {
  let nav = document.querySelector(".nav") as HTMLElement | null;
  if (!nav) {
    nav = document.createElement("nav");
    nav.className = "nav";
    document.body.appendChild(nav);

    // Single delegated click handler — all nav links route through navigate()
    nav.addEventListener("click", (e) => {
      const link = (e.target as HTMLElement).closest("a");
      if (!link) return;
      const href = link.getAttribute("href");
      if (!href) return;
      e.preventDefault();
      navigate(href);
    });
  }
  nav.innerHTML = NAV_ITEMS.map(
    (item) =>
      `<a href="${item.hash}" class="${active === item.hash ? "active" : ""}">
        <span class="nav-icon">${item.icon}</span>
        <span class="nav-label">${item.label}</span>
      </a>`,
  ).join("");
}

function renderStuffMenu(): HTMLElement {
  const menu = document.createElement("details");
  menu.className = "stuff-menu";

  const summary = document.createElement("summary");
  summary.className = "stuff-toggle";
  summary.setAttribute("aria-label", "Open Stuff menu");
  summary.innerHTML = `
    <span class="stuff-toggle-icon" aria-hidden="true">${gearIcon()}</span>
    <span class="stuff-toggle-label">Stuff</span>
  `;
  menu.appendChild(summary);

  const panel = document.createElement("div");
  panel.className = "stuff-panel";
  panel.innerHTML = `
    <div class="stuff-panel-title">Stuff</div>
    <nav class="stuff-list" aria-label="Stuff">
      <a href="#/about" data-stuff-nav>${infoIcon()}<span>About</span></a>
      <button type="button" data-observations class="stuff-action">${journalIcon()}<span>Observations</span></button>
      <div class="stuff-social">
        <div class="stuff-social-label">${shareIcon()}<span>Be social</span></div>
        <div class="stuff-social-grid">
          <button type="button" data-native-share>Share</button>
          <a href="${FACEBOOK_SHARE_URL}" target="_blank" rel="noopener">Facebook</a>
          <button type="button" data-instagram-share>Instagram</button>
          <a href="${SMS_SHARE_URL}">Text</a>
          <button type="button" data-copy-share>Copy link</button>
        </div>
      </div>
      <a href="${FEEDBACK_MAILTO}">${mailIcon()}<span>Feedback</span></a>
      <a href="${SUPPORT_MAILTO}">${supportIcon()}<span>Support</span></a>
      <a href="#/sources" data-stuff-nav>${slidersIcon()}<span>Settings</span></a>
    </nav>
    <div class="stuff-status" aria-live="polite"></div>
  `;
  menu.appendChild(panel);

  const status = panel.querySelector(".stuff-status") as HTMLElement | null;

  panel
    .querySelectorAll<HTMLAnchorElement>("[data-stuff-nav]")
    .forEach((link) => {
      link.addEventListener("click", (event) => {
        const href = link.getAttribute("href");
        if (!href) return;
        event.preventDefault();
        menu.removeAttribute("open");
        navigate(href);
      });
    });

  panel
    .querySelector<HTMLButtonElement>("[data-native-share]")
    ?.addEventListener("click", async () => {
      if (typeof navigator.share === "function") {
        try {
          await navigator.share({
            title: SHARE_TITLE,
            text: SHARE_TEXT,
            url: SHARE_URL,
          });
          menu.removeAttribute("open");
        } catch (error: unknown) {
          if (!isAbortError(error)) {
            await copyShare(status, "Share text copied");
          }
        }
        return;
      }

      await copyShare(status, "Share text copied");
    });

  panel
    .querySelector<HTMLButtonElement>("[data-copy-share]")
    ?.addEventListener("click", async () => {
      await copyShare(status, "Share text copied");
    });

  panel
    .querySelector<HTMLButtonElement>("[data-observations]")
    ?.addEventListener("click", () => {
      menu.removeAttribute("open");
      if (currentCtx) openObservationsModal(currentCtx);
    });

  panel
    .querySelector<HTMLButtonElement>("[data-instagram-share]")
    ?.addEventListener("click", async () => {
      await copyShare(status, "Copied for Instagram");
      window.open(
        "https://www.instagram.com/",
        "_blank",
        "noopener,noreferrer",
      );
    });

  panel
    .querySelectorAll<HTMLAnchorElement>("a:not([data-stuff-nav])")
    .forEach((link) => {
      link.addEventListener("click", () => menu.removeAttribute("open"));
    });

  return menu;
}

function buildMailto(subject: string, body: string): string {
  return `mailto:${DESK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

async function copyShare(
  status: HTMLElement | null,
  successMessage: string,
): Promise<void> {
  const copied = await writeClipboard(SHARE_COPY);
  setStuffStatus(status, copied ? successMessage : "Copy unavailable");
}

async function writeClipboard(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return fallbackCopy(text);
    }
  }

  return fallbackCopy(text);
}

function fallbackCopy(text: string): boolean {
  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "true");
  input.style.position = "fixed";
  input.style.left = "-9999px";
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  return copied;
}

function setStuffStatus(status: HTMLElement | null, message: string): void {
  if (!status) return;
  status.textContent = message;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function gearIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1A2 2 0 1 1 4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.4 7A2 2 0 1 1 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 1 1 19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1Z"/></svg>`;
}

function infoIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`;
}

function shareIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4"/><path d="m8.6 13.5 6.8 4"/></svg>`;
}

function mailIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>`;
}

function supportIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14a8 8 0 0 1 16 0"/><path d="M18 19c0 1.1-.9 2-2 2h-3"/><path d="M4 14v3a2 2 0 0 0 2 2h1v-7H6a2 2 0 0 0-2 2Z"/><path d="M20 14v3a2 2 0 0 1-2 2h-1v-7h1a2 2 0 0 1 2 2Z"/></svg>`;
}

function journalIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2Z"/><path d="M18 2v18"/><path d="M8 7h6"/><path d="M8 11h6"/><path d="M8 15h4"/></svg>`;
}

function slidersIcon(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M2 14h4"/><path d="M10 8h4"/><path d="M18 16h4"/></svg>`;
}

function formatLocation(loc: GeoLocation): string {
  const lat = Math.abs(loc.lat).toFixed(2) + (loc.lat >= 0 ? "°N" : "°S");
  const lon = Math.abs(loc.lon).toFixed(2) + (loc.lon >= 0 ? "°E" : "°W");
  return `${lat}, ${lon}`;
}
