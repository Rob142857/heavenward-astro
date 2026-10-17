/**
 * Altitude-vs-time chart for object pages: inline SVG, no chart library.
 *
 * Draws the model from engine/altitude-curve.ts: twilight bands, horizon and
 * minimum-altitude lines, the object's curve with rise/transit/set, the Moon's
 * curve (faint), the best window and a "now" marker. Drag, tap or use the
 * arrow keys to scrub; the readout shows time, altitude, azimuth and the
 * Moon's separation. The summary line under it is the chart's text form.
 */

import {
  analyseNight,
  chartSummary,
  hourTicks,
  nearestSample,
} from "../engine/altitude-curve.ts";
import type { AltitudeModel, Span } from "../engine/altitude-curve.ts";
import { azimuthToCompassShort } from "../engine/astro.ts";
import { formatClock } from "../services/sky-time.ts";
import { t } from "../i18n/translations.ts";

const W = 360;
const H = 200;
const PAD_L = 28;
const PAD_R = 8;
const PAD_T = 14;
const PAD_B = 20;
const PW = W - PAD_L - PAD_R;
const PH = H - PAD_T - PAD_B;

const MIN_ALT_KEY = "heavenward-min-alt";
const MIN_ALT_CHOICES = [0, 10, 20, 30, 40, 50, 60];
const SPAN_KEY = "heavenward-chart-span";

function loadNumber(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    return localStorage.getItem(key) !== null && Number.isFinite(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: keep it for this page only */
  }
}

export interface AltitudeChartOptions {
  model: AltitudeModel;
  /** IANA zone to print times in; undefined = device clock. */
  zone?: string;
  /** The page's moment (now, or the link's time). */
  now: number;
  /** True when `now` came from a deep link, so the marker says so. */
  linked: boolean;
}

const fmtNum = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

/** Mount the chart section into `slot`. */
export function mountAltitudeChart(slot: HTMLElement, opts: AltitudeChartOptions): void {
  const { model, zone } = opts;
  const fmt = (ms: number) => formatClock(new Date(ms), zone);
  let minAlt = loadNumber(MIN_ALT_KEY, 30);
  if (!MIN_ALT_CHOICES.includes(minAlt)) minAlt = 30;
  let span: "night" | "24h" = model.night
    ? (() => {
        try {
          return localStorage.getItem(SPAN_KEY) === "24h" ? "24h" : "night";
        } catch {
          return "night";
        }
      })()
    : "24h";

  const section = document.createElement("section");
  section.className = "detail-section alt-chart";
  section.setAttribute("aria-labelledby", "alt-chart-title");
  section.innerHTML = `
    <h3 class="detail-section-title" id="alt-chart-title">${t("chart.title")}</h3>
    <div class="alt-controls">
      ${
        model.night
          ? `<div class="alt-span" role="group" aria-label="${t("chart.spanLabel")}">
        <button type="button" class="alt-span-btn" data-span="night">${t("chart.viewNight")}</button>
        <button type="button" class="alt-span-btn" data-span="24h">${t("chart.view24h")}</button>
      </div>`
          : ""
      }
      <label class="alt-min">${t("chart.minAlt")}
        <select class="alt-min-select">
          ${MIN_ALT_CHOICES.map((v) => `<option value="${v}">${v}°</option>`).join("")}
        </select>
      </label>
    </div>
    <figure class="alt-figure">
      <div class="alt-plot" role="slider" tabindex="0" aria-label="${t("chart.scrubLabel")}"></div>
      <div class="alt-readout"></div>
      <figcaption class="alt-summary"></figcaption>
    </figure>
    <div class="alt-legend" aria-hidden="true"></div>
    <div class="alt-rts"></div>
  `;
  slot.replaceChildren(section);

  const plot = section.querySelector<HTMLElement>(".alt-plot")!;
  const readout = section.querySelector<HTMLElement>(".alt-readout")!;
  const summary = section.querySelector<HTMLElement>(".alt-summary")!;
  const legend = section.querySelector<HTMLElement>(".alt-legend")!;
  const rts = section.querySelector<HTMLElement>(".alt-rts")!;
  // TS 6 DOM typings reject a direct Element -> HTMLSelectElement cast.
  const select = section.querySelector(".alt-min-select") as unknown as HTMLSelectElement;
  select.value = String(minAlt);

  rts.innerHTML = rtsHtml(model, fmt);

  let view: Span = model.span24;
  let scrubI = 0;

  const xOf = (ms: number) => PAD_L + ((ms - view.start) / (view.end - view.start)) * PW;
  const yOf = (alt: number) => PAD_T + (1 - alt / 90) * PH;

  function draw(): void {
    view = span === "night" && model.night ? model.night : model.span24;
    const a = analyseNight(model, minAlt);
    const text = chartSummary(model, a, fmt, t);
    summary.textContent = text;
    plot.innerHTML = svgHtml(model, a.best, view, minAlt, opts, xOf, yOf, zone);

    section.querySelectorAll<HTMLButtonElement>(".alt-span-btn").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.span === span));
    });

    legend.innerHTML = [
      `<span><i class="sw sw-curve"></i>${model.isMoon ? t("chart.legendMoon", { illum: Math.round(model.moonIllum * 100) }) : t("chart.legendObject")}</span>`,
      a.best ? `<span><i class="sw sw-best"></i>${t("chart.legendBest")}</span>` : "",
      model.moon ? `<span><i class="sw sw-moon"></i>${t("chart.legendMoon", { illum: Math.round(model.moonIllum * 100) })}</span>` : "",
      `<span><i class="sw sw-dark"></i>${t("chart.bandDark")}</span>`,
      `<span><i class="sw sw-twilight"></i>${t("chart.bandTwilight")}</span>`,
    ].join("");

    // Start the scrubber at now when it is on the chart, else the peak.
    const startAt =
      opts.now >= view.start && opts.now <= view.end ? opts.now : a.peak.t;
    scrubTo(nearestSample(model, startAt));
  }

  function inView(i: number): number {
    const lo = nearestSample(model, view.start);
    const hi = nearestSample(model, view.end);
    return Math.max(lo, Math.min(hi, i));
  }

  function scrubTo(i: number): void {
    scrubI = inView(i);
    const s = model.samples[scrubI];
    const g = plot.querySelector<SVGGElement>(".alt-scrub");
    if (g) {
      const x = xOf(s.t);
      g.setAttribute("transform", `translate(${x.toFixed(1)},0)`);
      const dot = g.querySelector("circle")!;
      dot.setAttribute("cy", yOf(Math.max(-5, s.alt)).toFixed(1));
      dot.style.display = s.alt >= 0 ? "" : "none";
    }
    const moon = model.moon?.[scrubI];
    const parts = [
      fmt(s.t),
      `${fmtNum(s.alt)}° ${azimuthToCompassShort(s.az)}`,
      t("chart.readoutAz", { az: Math.round(s.az) }),
    ];
    if (moon) {
      parts.push(
        moon.alt > 0
          ? t("chart.readoutMoon", { sep: Math.round(moon.sep) })
          : t("chart.readoutMoonDown"),
      );
    }
    const text = parts.join(" · ");
    readout.textContent = text;
    const startI = nearestSample(model, view.start);
    plot.setAttribute("aria-valuemin", "0");
    plot.setAttribute("aria-valuemax", String(nearestSample(model, view.end) - startI));
    plot.setAttribute("aria-valuenow", String(scrubI - startI));
    plot.setAttribute("aria-valuetext", text);
  }

  function scrubFromPointer(ev: PointerEvent): void {
    const svg = plot.querySelector("svg");
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * W;
    const ms = view.start + ((x - PAD_L) / PW) * (view.end - view.start);
    scrubTo(nearestSample(model, ms));
  }

  plot.addEventListener("pointerdown", (ev) => {
    plot.setPointerCapture?.(ev.pointerId);
    scrubFromPointer(ev);
  });
  plot.addEventListener("pointermove", (ev) => {
    if (ev.pointerType === "mouse" && ev.buttons === 0) {
      scrubFromPointer(ev); // hover on desktop
      return;
    }
    if (plot.hasPointerCapture?.(ev.pointerId)) scrubFromPointer(ev);
  });
  plot.addEventListener("keydown", (ev) => {
    const hour = 12; // samples per hour
    const moves: Record<string, number> = {
      ArrowRight: 1,
      ArrowUp: 1,
      ArrowLeft: -1,
      ArrowDown: -1,
      PageUp: hour,
      PageDown: -hour,
    };
    if (ev.key in moves) scrubTo(scrubI + moves[ev.key]);
    else if (ev.key === "Home") scrubTo(0);
    else if (ev.key === "End") scrubTo(model.samples.length - 1);
    else return;
    ev.preventDefault();
  });

  section.querySelectorAll<HTMLButtonElement>(".alt-span-btn").forEach((b) =>
    b.addEventListener("click", () => {
      span = b.dataset.span === "24h" ? "24h" : "night";
      save(SPAN_KEY, span);
      draw();
    }),
  );
  select.addEventListener("change", () => {
    minAlt = Number(select.value);
    save(MIN_ALT_KEY, String(minAlt));
    draw();
  });

  draw();
}

function rtsHtml(model: AltitudeModel, fmt: (ms: number) => string): string {
  const item = (label: string, value: string) =>
    `<div class="detail-item"><div class="label">${label}</div><div class="value">${value}</div></div>`;
  const dirAt = (ms: number) => {
    const i = nearestSample(model, ms);
    return azimuthToCompassShort(model.samples[i].az);
  };
  const transit =
    model.transit !== null && model.transitAlt !== null && model.transitAlt > 0
      ? item(
          t("detail.label.transit"),
          `${fmt(model.transit)} <span class="alt-sub">${Math.round(model.transitAlt)}° ${azimuthToCompassShort(model.transitAz ?? 0)}</span>`,
        )
      : "";
  switch (model.state) {
    case "always-up":
      return `<div class="detail-grid alt-rts-grid">${item(t("detail.label.rise"), t("tonight.alwaysUp"))}${transit}</div>`;
    case "never-rises":
      return `<div class="detail-grid alt-rts-grid">${item(t("detail.label.rise"), t("tonight.neverRises"))}</div>`;
    case "up-all-day":
      return `<div class="detail-grid alt-rts-grid">${item(t("detail.label.rise"), t("chart.upAllDay"))}${transit}</div>`;
    case "down-all-day":
      return `<div class="detail-grid alt-rts-grid">${item(t("detail.label.rise"), t("chart.downAllDay"))}</div>`;
    default:
      return `<div class="detail-grid alt-rts-grid">
        ${item(t("detail.label.rise"), model.rise !== null ? `${fmt(model.rise)} <span class="alt-sub">${dirAt(model.rise)}</span>` : "—")}
        ${transit || item(t("detail.label.transit"), "—")}
        ${item(t("detail.label.set"), model.set !== null ? `${fmt(model.set)} <span class="alt-sub">${dirAt(model.set)}</span>` : "—")}
      </div>`;
  }
}

function pathFor(
  pts: { t: number; alt: number }[],
  view: Span,
  xOf: (ms: number) => number,
  yOf: (alt: number) => number,
): string {
  const step = pts.length > 1 ? pts[1].t - pts[0].t : 0;
  let d = "";
  for (const p of pts) {
    if (p.t < view.start - step || p.t > view.end + step) continue;
    d += `${d ? "L" : "M"}${xOf(p.t).toFixed(1)},${yOf(p.alt).toFixed(1)}`;
  }
  return d;
}

function svgHtml(
  model: AltitudeModel,
  best: { start: number; end: number } | null,
  view: Span,
  minAlt: number,
  opts: AltitudeChartOptions,
  xOf: (ms: number) => number,
  yOf: (alt: number) => number,
  zone: string | undefined,
): string {
  const out: string[] = [];
  const clamp = (x: number) => Math.max(PAD_L, Math.min(PAD_L + PW, x));
  out.push(
    `<svg viewBox="0 0 ${W} ${H}" class="alt-svg" aria-hidden="true" focusable="false">`,
    `<defs><clipPath id="alt-clip"><rect x="${PAD_L}" y="${PAD_T}" width="${PW}" height="${PH}"/></clipPath></defs>`,
  );

  // Twilight bands.
  for (const b of model.bands) {
    if (b.to < view.start || b.from > view.end) continue;
    const x1 = clamp(xOf(b.from));
    const x2 = clamp(xOf(b.to));
    out.push(`<rect class="alt-band alt-band-${b.kind}" x="${x1.toFixed(1)}" y="${PAD_T}" width="${Math.max(0, x2 - x1).toFixed(1)}" height="${PH}"/>`);
  }

  // Best window.
  if (best) {
    const x1 = clamp(xOf(best.start));
    const x2 = clamp(xOf(best.end));
    out.push(`<rect class="alt-best" x="${x1.toFixed(1)}" y="${PAD_T}" width="${(x2 - x1).toFixed(1)}" height="${PH}"/>`);
  }

  // Grid, horizon, minimum line, y labels.
  for (const a of [30, 60, 90]) {
    out.push(`<line class="alt-grid" x1="${PAD_L}" x2="${PAD_L + PW}" y1="${yOf(a)}" y2="${yOf(a)}"/>`);
  }
  for (const a of [0, 30, 60, 90]) {
    out.push(`<text class="alt-axis" x="${PAD_L - 4}" y="${yOf(a) + 3.5}" text-anchor="end">${a}°</text>`);
  }
  if (minAlt > 0) {
    out.push(`<line class="alt-minline" x1="${PAD_L}" x2="${PAD_L + PW}" y1="${yOf(minAlt)}" y2="${yOf(minAlt)}"/>`);
    if (minAlt % 30 !== 0) {
      out.push(`<text class="alt-axis" x="${PAD_L - 4}" y="${yOf(minAlt) + 3.5}" text-anchor="end">${minAlt}°</text>`);
    }
  }
  out.push(`<line class="alt-horizon" x1="${PAD_L}" x2="${PAD_L + PW}" y1="${yOf(0)}" y2="${yOf(0)}"/>`);

  // Hour ticks on the zone's clock.
  const ticks = hourTicks(view.start, view.end, zone);
  const every = ticks.length > 14 ? 3 : ticks.length > 8 ? 2 : 1;
  const hourFmt = new Intl.DateTimeFormat([], { hour: "numeric", ...(zone ? { timeZone: zone } : {}) });
  ticks.forEach((k, i) => {
    const x = xOf(k.t).toFixed(1);
    out.push(`<line class="alt-tick" x1="${x}" x2="${x}" y1="${PAD_T + PH}" y2="${PAD_T + PH + 3}"/>`);
    if (k.hour % every === 0 || (every > 1 && i === 0 && ticks.length < 3)) {
      const label = hourFmt.format(new Date(k.t)).replace(/\s/g, " ");
      out.push(`<text class="alt-axis" x="${x}" y="${H - 5}" text-anchor="middle">${label}</text>`);
    }
  });

  // Curves, clipped to the plot.
  out.push(`<g clip-path="url(#alt-clip)">`);
  if (model.moon) {
    const moonPts = model.samples.map((s, i) => ({ t: s.t, alt: model.moon![i].alt }));
    out.push(`<path class="alt-moon" d="${pathFor(moonPts, view, xOf, yOf)}"/>`);
  }
  out.push(`<path class="alt-curve" d="${pathFor(model.samples, view, xOf, yOf)}"/>`);
  if (best) {
    const seg = model.samples.filter((s) => s.t >= best.start && s.t <= best.end);
    const pts = [
      { t: best.start, alt: model.altAt(best.start) },
      ...seg,
      { t: best.end, alt: model.altAt(best.end) },
    ];
    out.push(`<path class="alt-curve-best" d="${pathFor(pts, { start: -Infinity, end: Infinity }, xOf, yOf)}"/>`);
  }
  out.push(`</g>`);

  if (model.state === "never-rises" || model.samples.every((s) => s.alt <= 0)) {
    out.push(`<text class="alt-note" x="${PAD_L + PW / 2}" y="${PAD_T + PH / 2}" text-anchor="middle">${t("chart.belowAllNightShort")}</text>`);
  }

  // Rise, transit and set marks with direction labels.
  const mark = (ms: number | null, alt: number, label: string, cls: string) => {
    if (ms === null || ms < view.start || ms > view.end) return;
    const x = xOf(ms);
    const y = yOf(Math.max(0, alt));
    const anchor = x < PAD_L + 24 ? "start" : x > PAD_L + PW - 24 ? "end" : "middle";
    out.push(
      `<circle class="alt-mark ${cls}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3"/>`,
      `<text class="alt-mark-label" x="${x.toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="${anchor}">${label}</text>`,
    );
  };
  const dirAt = (ms: number) => azimuthToCompassShort(model.samples[nearestSample(model, ms)].az);
  if (model.rise !== null) mark(model.rise, 0, `↑${dirAt(model.rise)}`, "alt-mark-rise");
  if (model.set !== null) mark(model.set, 0, `↓${dirAt(model.set)}`, "alt-mark-set");
  if (model.transit !== null && model.transitAlt !== null && model.transitAlt > 0) {
    mark(model.transit, model.transitAlt, `${Math.round(model.transitAlt)}° ${azimuthToCompassShort(model.transitAz ?? 0)}`, "alt-mark-transit");
  }

  // Now (or the link's time).
  if (opts.now >= view.start && opts.now <= view.end) {
    const x = xOf(opts.now).toFixed(1);
    out.push(
      `<line class="alt-now" x1="${x}" x2="${x}" y1="${PAD_T}" y2="${PAD_T + PH}"/>`,
      `<text class="alt-now-label" x="${x}" y="${PAD_T - 4}" text-anchor="middle">${opts.linked ? t("chart.linkTime") : t("chart.now")}</text>`,
    );
  }

  // Scrubber (moved by transform).
  out.push(
    `<g class="alt-scrub"><line x1="0" x2="0" y1="${PAD_T}" y2="${PAD_T + PH}"/><circle cx="0" cy="0" r="4.5"/></g>`,
    `</svg>`,
  );
  return out.join("");
}
