// UI renderers for "Sources" route (includes Settings UI)

import type { AppContext } from "../types.js";
import { renderHeader, renderNav } from "./layout.js";
import { t } from "../i18n/translations.js";

export function renderSources(container: HTMLElement, ctx: AppContext): void {
  container.innerHTML = "";
  renderHeader(container, ctx);
  renderNav("#/sources");

  const title = document.createElement("h3");
  title.className = "section-title";
  title.textContent = t("settings");
  container.appendChild(title);

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "App version 1.0.1";
  container.appendChild(hint);

  container.appendChild(createLink("Privacy", "https://sky.incitat.io/about/terms"));
  container.appendChild(createLink("Terms of Service", "https://sky.incitat.io/about/privacy"));
  container.appendChild(createLink("GitHub", "https://github.com/Rob142857/heavenward"));
}

function createLink(text: string, href: string): HTMLElement {
  const a = document.createElement("a");
  a.className = "settings-link";
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = text;
  return a;
}