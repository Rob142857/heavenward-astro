/**
 * Tonight's Best on the home page: filters (type, equipment) and the ranked
 * rows. The ranking itself is engine/tonight-best.ts; this file only draws.
 */
import type { AppContext } from "../types.js";
import { loadDSOCatalog } from "../catalog/dso.js";
import { loadStarCatalog } from "../catalog/stars.js";
import { SHOWPIECE_DOUBLES } from "../catalog/doubles.ts";
import {
  BEST_GROUPS,
  buildCandidates,
  compassOf,
  rankTonightsBest,
  whyParts,
  type BestCandidate,
  type BestGroup,
  type BestResult,
  type BestRow,
} from "../engine/tonight-best.ts";
import { EQUIPMENT_CLASSES, type EquipmentClass } from "../engine/equipment.ts";
import { cloudOption, type CloudForecast } from "../engine/cloud.ts";
import { fetchCloudForecast, forecastWithin } from "../services/weather.ts";
import { paintCloudBlock } from "./cloud.ts";
import { formatClock } from "../services/sky-time.js";
import { savePrefs } from "../services/prefs.js";
import { trackEvent } from "../services/analytics.js";
import { navigate } from "./router.js";
import { t } from "../i18n/translations.js";

const MIN_ALT = 30;

/** How long the list waits for the cloud forecast before ranking without it.
 *  A later answer re-ranks once. */
const FORECAST_WAIT_MS = 2_500;

let candidates: Promise<BestCandidate[]> | null = null;
function loadCandidates(): Promise<BestCandidate[]> {
  candidates ??= Promise.all([loadDSOCatalog(), loadStarCatalog()]).then(
    ([dsos, stars]) => buildCandidates(dsos, stars, SHOWPIECE_DOUBLES),
  );
  return candidates;
}

/** Last result, so filter taps on the same night don't redo identical work. */
let cache: { key: string; result: BestResult } | null = null;

function equipmentOf(ctx: AppContext): EquipmentClass {
  return ctx.prefs.bestEquipment ?? "binoculars";
}
function groupsOf(ctx: AppContext): BestGroup[] {
  return ctx.prefs.bestGroups ?? [];
}

export function renderTonightsBest(
  container: HTMLElement,
  ctx: AppContext,
  now: Date,
  zone: string | undefined,
): void {
  // "Is it clear?" sits above the list; hidden until a forecast covers tonight.
  const cloudBlock = document.createElement("section");
  cloudBlock.className = "cloud-block";
  cloudBlock.setAttribute("aria-labelledby", "cloud-title");
  cloudBlock.hidden = true;
  container.appendChild(cloudBlock);

  const section = document.createElement("section");
  section.className = "best-section";
  section.setAttribute("aria-labelledby", "best-title");
  section.innerHTML = `
    <div class="best-head">
      <h2 class="section-title best-title" id="best-title">${t("best.title")}</h2>
      <span class="best-when"></span>
    </div>
    <div class="best-filters">
      <div class="best-chips" role="group" aria-label="${t("best.typesLabel")}"></div>
      <label class="best-eq">
        <span class="best-eq-label">${t("best.equipmentLabel")}</span>
        <select class="ctrl-select best-eq-select" aria-label="${t("best.equipmentLabel")}">
          ${EQUIPMENT_CLASSES.map((c) => `<option value="${c}">${t(`best.eq.${c}`)}</option>`).join("")}
        </select>
      </label>
    </div>
    <ol class="best-list" aria-busy="true">
      ${Array.from({ length: 4 }, () => `<li class="best-row skeleton" aria-hidden="true"></li>`).join("")}
    </ol>
    <p class="best-status" role="status" aria-live="polite">${t("best.loading")}</p>
    <details class="best-rule">
      <summary>${t("best.ruleSummary")}</summary>
      <p>${t("best.rule")}</p>
    </details>
  `;
  container.appendChild(section);

  const chips = section.querySelector<HTMLElement>(".best-chips")!;
  const select = section.querySelector(".best-eq-select") as unknown as HTMLSelectElement;
  const list = section.querySelector<HTMLOListElement>(".best-list")!;
  const status = section.querySelector<HTMLElement>(".best-status")!;
  const when = section.querySelector<HTMLElement>(".best-when")!;
  select.value = equipmentOf(ctx);

  const paintChips = (): void => {
    const active = groupsOf(ctx);
    const chip = (key: string, label: string, on: boolean) =>
      `<button type="button" class="best-chip${on ? " active" : ""}" data-group="${key}" aria-pressed="${on}">${label}</button>`;
    chips.innerHTML =
      chip("all", t("best.allTypes"), active.length === 0) +
      BEST_GROUPS.map((g) => chip(g, t(`best.group.${g}`), active.includes(g))).join("");
  };
  paintChips();

  let run = 0;
  const update = (): void => {
    const mine = ++run;
    list.setAttribute("aria-busy", "true");
    const forecast = fetchCloudForecast(ctx.location);
    Promise.all([loadCandidates(), forecastWithin(ctx.location, FORECAST_WAIT_MS)])
      .then(([cands, fc]) => {
        // The forecast came after the wait: rank again once it lands.
        if (!fc)
          void forecast.then((late) => {
            if (late && mine === run && section.isConnected) update();
          });
        if (mine !== run || !section.isConnected) return;
        // Yield a task so the chip/select state can paint before the short
        // ranking pass. Not requestAnimationFrame: it never fires in a
        // background tab, which left the list on "Working out…".
        setTimeout(() => {
          if (mine !== run || !section.isConnected) return;
          const opts = {
            equipment: equipmentOf(ctx),
            groups: groupsOf(ctx),
            minAlt: MIN_ALT,
            cloud: cloudOption(fc),
          };
          const key = [
            ctx.location.lat.toFixed(3),
            ctx.location.lon.toFixed(3),
            Math.floor(now.getTime() / 600_000),
            opts.equipment,
            opts.groups.join(","),
            fc ? `${fc.cell.lat},${fc.cell.lon},${fc.fetchedAt}` : "no-cloud",
          ].join("|");
          const result =
            cache?.key === key ? cache.result : rankTonightsBest(cands, ctx.location, now, opts);
          cache = { key, result };
          paintRows(list, status, when, result, opts, zone);
          paintCloud(cloudBlock, fc, result, zone);
        }, 0);
      })
      .catch(() => {
        if (mine !== run || !section.isConnected) return;
        list.innerHTML = "";
        list.removeAttribute("aria-busy");
        status.textContent = t("common.dataLoadError");
      });
  };

  chips.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".best-chip");
    if (!btn) return;
    const g = btn.dataset.group as BestGroup | "all";
    let next: BestGroup[];
    if (g === "all") next = [];
    else {
      const cur = new Set(groupsOf(ctx));
      if (cur.has(g)) cur.delete(g);
      else cur.add(g);
      next = cur.size === BEST_GROUPS.length ? [] : BEST_GROUPS.filter((x) => cur.has(x));
    }
    ctx.prefs.bestGroups = next;
    savePrefs(ctx.prefs);
    paintChips();
    update();
  });
  select.addEventListener("change", () => {
    ctx.prefs.bestEquipment = select.value as EquipmentClass;
    savePrefs(ctx.prefs);
    update();
  });

  update();
}

function paintRows(
  list: HTMLOListElement,
  status: HTMLElement,
  when: HTMLElement,
  result: BestResult,
  opts: { equipment: EquipmentClass; minAlt: number },
  zone: string | undefined,
): void {
  const fmt = (ms: number) => formatClock(new Date(ms), zone);
  const g = result.grid;
  const parts: string[] = [];
  if (g.dark) parts.push(t("best.fromDusk", { time: fmt(g.dark.start) }));
  else parts.push(t("best.noDark"));
  parts.push(t("best.moonSummary", { illum: Math.round(g.moonIllum * 100) }));
  when.textContent = parts.join(" · ");

  list.innerHTML = "";
  list.removeAttribute("aria-busy");
  status.textContent = result.rows.length ? "" : t("best.empty");
  for (const row of result.rows) list.appendChild(buildRow(row, result, opts, fmt));
}

function paintCloud(
  el: HTMLElement,
  fc: CloudForecast | null,
  result: BestResult,
  zone: string | undefined,
): void {
  const g = result.grid;
  paintCloudBlock(el, fc, g.dark ?? g.night, (ms) => formatClock(new Date(ms), zone), zone);
}

function typeLabel(row: BestRow): string {
  const key = `best.type.${row.cand.typeKey}`;
  const label = t(key);
  return label === key ? row.cand.typeKey.replace(/-/g, " ") : label;
}

function buildRow(
  row: BestRow,
  result: BestResult,
  opts: { equipment: EquipmentClass; minAlt: number },
  fmt: (ms: number) => string,
): HTMLLIElement {
  const li = document.createElement("li");
  li.className = `best-row${row.pinned ? " pinned" : ""}`;
  li.dataset.id = row.cand.id;
  const why = whyParts(row, opts)
    .slice(0, 3)
    .map((p) => t(p.key, p.params))
    .join(" · ");
  const dir = compassOf(row);
  const alt = Math.round(row.peakAlt);
  const type = typeLabel(row);
  // A real link inside a real list item: the row is announced as a link whose
  // name is its visible text (name, type, window, peak, why), and Enter works
  // natively. (A role="link" on the <li> itself is not allowed by ARIA and
  // broke the list semantics.)
  li.innerHTML = `<a class="best-link" href="#/detail/${escapeHtml(row.cand.id)}">
    <div class="best-main">
      <div class="best-name"><span class="best-name-text">${escapeHtml(row.cand.name)}</span><span class="best-type">${escapeHtml(type)}</span></div>
      <div class="best-meta"><span class="best-window">${fmt(row.start)}–${fmt(row.end)}</span> · <span class="best-peak">${t("best.peak", { alt, dir })}</span></div>
      <div class="best-why">${escapeHtml(why)}</div>
    </div>
    ${sparkline(row, result, opts.minAlt)}
  </a>`;
  li.addEventListener("click", (e) => {
    // Let new-tab / copy-link gestures through; plain taps use the router.
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    trackEvent("click", `#/detail/${row.cand.id}`, row.cand.name);
    navigate(`#/detail/${row.cand.id}`);
  });
  return li;
}

const SW = 88;
const SH = 32;

/** Altitude from sunset to sunrise: dark band, 30° line, best window in gold. */
function sparkline(row: BestRow, result: BestResult, minAlt: number): string {
  const pts = row.spark;
  if (pts.length < 2) return "";
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  const x = (ms: number) => ((ms - t0) / (t1 - t0)) * SW;
  const y = (alt: number) => SH - 1 - (Math.max(0, alt) / 90) * (SH - 2);
  const line = (sel: typeof pts) =>
    sel.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.alt).toFixed(1)}`).join("");
  const win = pts.filter((p) => p.t >= row.start - 450_000 && p.t <= row.end + 450_000);
  const dark = result.grid.dark;
  const band = dark
    ? `<rect class="spark-dark" x="${Math.max(0, x(dark.start)).toFixed(1)}" y="0" width="${(Math.min(SW, x(dark.end)) - Math.max(0, x(dark.start))).toFixed(1)}" height="${SH}"/>`
    : "";
  return `<svg class="best-spark" viewBox="0 0 ${SW} ${SH}" width="${SW}" height="${SH}" aria-hidden="true" focusable="false">
    ${band}
    <line class="spark-min" x1="0" x2="${SW}" y1="${y(minAlt).toFixed(1)}" y2="${y(minAlt).toFixed(1)}"/>
    <path class="spark-curve" d="${line(pts)}"/>
    ${win.length > 1 ? `<path class="spark-best" d="${line(win)}"/>` : ""}
  </svg>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
