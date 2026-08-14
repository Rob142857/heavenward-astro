import type { AppContext } from "../types.js";
import { t } from "../i18n/translations.js";
import { renderHeader, renderNav } from "./layout.js";
import {
  exportSessionMarkdown,
  getCurrentSession,
  saveSessionToAccount,
  clearCurrentSession,
  deleteObservation,
  type ObservationSession,
  type SavedObservationSummary,
} from "../services/observations.js";
import { navigate } from "./router.js";

const observationRenderVersions = new WeakMap<HTMLElement, number>();

async function loadObservationHistory(): Promise<SavedObservationSummary[]> {
  // Keep this read local to the surface so HTTP/JSON failures remain visible
  // here. The shared helper intentionally turns them into an empty array,
  // which would make an unavailable history endpoint look like no history.
  const response = await fetch("/api/observations", {
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = (await response.json()) as {
    ok: boolean;
    data?: SavedObservationSummary[];
  };
  if (!data.ok || !Array.isArray(data.data)) {
    throw new Error("Invalid observation history response");
  }
  return data.data;
}

// ── Modal: current session export ─────────────────────────────────

export function openObservationsModal(ctx: AppContext): void {
  const session = getCurrentSession();
  const backdrop = document.createElement("div");
  backdrop.className = "obs-backdrop";
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");

  const modal = document.createElement("div");
  modal.className = "obs-modal";

  const isEmpty = !session || session.entries.length === 0;

  modal.innerHTML = `
    <header class="obs-modal-head">
      <h3>${t("observations.modalTitle")}</h3>
      <button type="button" class="obs-close" aria-label="${t("observations.close")}">×</button>
    </header>
    <div class="obs-modal-body">
      ${
        isEmpty
          ? `<p class="obs-empty">${t("observations.emptyState")}</p>`
          : renderSessionPreview(session!)
      }
      ${
        !isEmpty
          ? `
        <label class="obs-checkbox">
          <input type="checkbox" data-include-gps />
          <span>${t("observations.includeGpsLabel")}</span>
        </label>
        <textarea class="obs-notes" placeholder="${t("observations.notesPlaceholder")}"></textarea>
        <pre class="obs-export" aria-live="polite"></pre>
        <div class="obs-actions">
          <button type="button" class="btn btn-primary" data-copy>${t("observations.copyButton")}</button>
          ${
            ctx.user
              ? `<button type="button" class="btn btn-outline" data-save>${t("observations.saveToAccount")}</button>`
              : `<a class="btn btn-outline" href="#/account" data-stuff-nav>${t("observations.signInToSave")}</a>`
          }
          <button type="button" class="btn btn-ghost" data-clear>${t("observations.startNew")}</button>
        </div>
        <div class="obs-status" aria-live="polite"></div>
      `
          : ""
      }
      ${
        ctx.user
          ? `<a class="obs-history-link" href="#/observations">${t("observations.viewSavedObservations")}</a>`
          : ""
      }
    </div>
  `;

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  modal.querySelector(".obs-close")?.addEventListener("click", close);

  if (isEmpty) return;

  const includeGps =
    modal.querySelector<HTMLInputElement>("[data-include-gps]")!;
  const notes = modal.querySelector<HTMLTextAreaElement>(".obs-notes")!;
  const preview = modal.querySelector<HTMLPreElement>(".obs-export")!;
  const status = modal.querySelector<HTMLElement>(".obs-status")!;

  const refresh = () => {
    preview.textContent = exportSessionMarkdown(session!, {
      includeExactGps: includeGps.checked,
      notes: notes.value,
    });
  };
  refresh();
  includeGps.addEventListener("change", refresh);
  notes.addEventListener("input", refresh);

  modal.querySelector("[data-copy]")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(preview.textContent ?? "");
      status.textContent = t("observations.copiedStatus");
    } catch {
      status.textContent = t("observations.copyFailedStatus");
    }
  });

  modal.querySelector("[data-save]")?.addEventListener("click", async () => {
    status.textContent = t("observations.savingStatus");
    const result = await saveSessionToAccount(session!);
    status.textContent = result.ok
      ? t("observations.savedStatus")
      : result.error
        ? t("observations.saveFailedWithError", { error: result.error })
        : t("observations.saveFailedStatus");
  });

  modal.querySelector("[data-clear]")?.addEventListener("click", () => {
    if (!confirm(t("observations.confirmStartNew"))) return;
    clearCurrentSession();
    close();
  });

  modal
    .querySelector<HTMLAnchorElement>("a[data-stuff-nav]")
    ?.addEventListener("click", (e) => {
      e.preventDefault();
      close();
      navigate("#/account");
    });
}

function renderSessionPreview(session: ObservationSession): string {
  const count = session.entries.length;
  const place = session.region ?? t("observations.yourLocation");
  const start = new Date(session.startedAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const objectLabel =
    count === 1
      ? t("observations.objectSingular")
      : t("observations.objectPlural");
  return `
    <p class="obs-summary">
      <strong>${count}</strong> ${t("observations.viewedSince", { objectLabel, start, place })}
    </p>
  `;
}

// ── History view (route: #/observations) ─────────────────────────

export async function renderObservations(
  container: HTMLElement,
  ctx: AppContext,
): Promise<void> {
  const renderVersion = (observationRenderVersions.get(container) ?? 0) + 1;
  observationRenderVersions.set(container, renderVersion);
  const isCurrentRender = () =>
    observationRenderVersions.get(container) === renderVersion &&
    container.isConnected;

  container.innerHTML = "";
  renderHeader(container, ctx);
  renderNav("#/account");
  const renderMarker = document.createComment("observations-render");
  container.appendChild(renderMarker);
  const routeIsStillCurrent = () =>
    isCurrentRender() && renderMarker.isConnected;

  const title = document.createElement("h3");
  title.className = "section-title";
  title.textContent = t("observations.historyTitle");
  container.appendChild(title);

  if (!ctx.user) {
    const note = document.createElement("p");
    note.className = "muted-prose";
    note.innerHTML = `${t("observations.signInPrompt")} <a href="#/account" class="wiki-link">${t("observations.signInLink")}</a>`;
    container.appendChild(note);
    return;
  }

  const loading = document.createElement("p");
  loading.className = "muted-prose";
  loading.textContent = t("observations.loading");
  container.appendChild(loading);

  let history: SavedObservationSummary[];
  try {
    history = await loadObservationHistory();
  } catch {
    if (!routeIsStillCurrent()) return;
    loading.remove();
    const error = document.createElement("p");
    error.className = "muted-prose";
    error.textContent = t("observations.loadFailed");
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "btn btn-outline";
    retry.textContent = t("common.tryAgain");
    retry.addEventListener("click", () => void renderObservations(container, ctx));
    container.appendChild(error);
    container.appendChild(retry);
    return;
  }
  if (!routeIsStillCurrent()) return;
  loading.remove();

  if (history.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted-prose";
    empty.textContent = t("observations.noHistory");
    container.appendChild(empty);
    return;
  }

  const list = document.createElement("div");
  list.className = "obs-history";
  for (const item of history) {
    list.appendChild(
      renderHistoryItem(item, () => {
        if (routeIsStillCurrent()) void renderObservations(container, ctx);
      }),
    );
  }
  container.appendChild(list);
}

function renderHistoryItem(
  item: SavedObservationSummary,
  onChange: () => void,
): HTMLElement {
  const card = document.createElement("article");
  card.className = "obs-history-item";
  const date = new Date(item.startedAt).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const start = new Date(item.startedAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const end = new Date(item.endedAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const region = item.region ?? t("observations.locationNotRecorded");
  const objectLabel =
    item.entryCount === 1
      ? t("observations.objectSingular")
      : t("observations.objectPlural");
  card.innerHTML = `
    <header class="obs-history-head">
      <div>
        <div class="obs-history-date">${date}</div>
        <div class="obs-history-meta">${start}–${end} · ${region} · ${item.entryCount} ${objectLabel}</div>
      </div>
      <button type="button" class="obs-history-del" aria-label="${t("observations.delete")}">×</button>
    </header>
    <ul class="obs-history-list">
      ${item.entries
        .slice(0, 12)
        .map(
          (e) =>
            `<li><a href="#/detail/${e.id}" class="wiki-link">${e.name}</a></li>`,
        )
        .join("")}
      ${item.entries.length > 12 ? `<li class="obs-history-more">${t("observations.moreCount", { count: item.entries.length - 12 })}</li>` : ""}
    </ul>
  `;
  card
    .querySelector(".obs-history-del")
    ?.addEventListener("click", async () => {
      if (!confirm(t("observations.confirmDelete"))) return;
      const ok = await deleteObservation(item.id);
      if (ok) onChange();
    });
  return card;
}
