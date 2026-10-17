/**
 * "Is it clear?" on Tonight: low, mid and high cloud by hour for tonight's
 * dark hours, with a one-line verdict. Drawn only when a forecast covers the
 * night; otherwise the block stays hidden and the page is as before.
 */
import {
  hoursInWindow,
  summariseHours,
  type CloudForecast,
  type CloudHour,
} from "../engine/cloud.ts";
import { t } from "../i18n/translations.js";

export const OPEN_METEO_LINK = `<a href="https://open-meteo.com/" target="_blank" rel="noopener" class="wiki-link">Open-Meteo.com</a>`;

/** "Weather data by Open-Meteo.com (CC BY 4.0)", with the link. */
export function openMeteoCredit(): string {
  return t("cloud.attribution", { link: OPEN_METEO_LINK });
}

/**
 * Fill `el` with the cloud block for `win` (tonight's dark, else the night).
 * Hides it when there is no forecast or no forecast hour in the window.
 */
export function paintCloudBlock(
  el: HTMLElement,
  fc: CloudForecast | null,
  win: { start: number; end: number } | null,
  fmt: (ms: number) => string,
  zone: string | undefined,
): void {
  const hours = fc && win ? hoursInWindow(fc, win.start, win.end) : [];
  const sum = summariseHours(hours);
  if (!win || !sum) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }
  const hourFmt = new Intl.DateTimeFormat([], {
    hour: "numeric",
    ...(zone ? { timeZone: zone } : {}),
  });
  const label = (ms: number) => hourFmt.format(new Date(ms)).replace(/\s/g, " ");
  const pct = (v: number | null) => (v === null ? "–" : String(v));
  const cell = (h: CloudHour, v: number | null) =>
    `<td class="cloud-cell" style="--cover:${v === null ? 0 : (v / 100).toFixed(2)}">${pct(v)}</td>`;
  const row = (key: "high" | "mid" | "low") =>
    `<tr><th scope="row">${t(`cloud.${key}`)}</th>${hours.map((h) => cell(h, h[key])).join("")}</tr>`;

  const parts = [
    t("cloud.summary", { pct: sum.meanPct, start: fmt(win.start), end: fmt(win.end) }),
  ];
  if (sum.minVis !== null && sum.minVis < 10_000) {
    parts.push(t("cloud.haze", { km: Math.max(0.1, Math.round(sum.minVis / 100) / 10) }));
  }

  el.hidden = false;
  el.innerHTML = `
    <div class="cloud-head">
      <h2 class="section-title cloud-title" id="cloud-title">${t("cloud.title")}</h2>
      <span class="cloud-verdict cloud-${sum.verdict}">${t(`cloud.verdict.${sum.verdict}`)}</span>
    </div>
    <p class="cloud-summary">${parts.join(" ")}</p>
    <div class="cloud-grid-wrap">
      <table class="cloud-grid">
        <caption class="sr-only">${t("cloud.tableLabel")}</caption>
        <thead><tr><th scope="col"><span class="sr-only">${t("cloud.levelHeader")}</span></th>${hours
          .map((h) => `<th scope="col">${label(h.t)}</th>`)
          .join("")}</tr></thead>
        <tbody>${row("high")}${row("mid")}${row("low")}</tbody>
      </table>
    </div>
    <p class="cloud-credit">${openMeteoCredit()}</p>
  `;
}
