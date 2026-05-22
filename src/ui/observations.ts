import type { AppContext } from "../types.js";
import { renderHeader, renderNav } from "./layout.js";
import {
  exportSessionMarkdown,
  fetchObservationHistory,
  getCurrentSession,
  saveSessionToAccount,
  clearCurrentSession,
  deleteObservation,
  type ObservationSession,
  type SavedObservationSummary,
} from "../services/observations.js";
import { navigate } from "./router.js";

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
      <h3>Tonight's observations</h3>
      <button type="button" class="obs-close" aria-label="Close">×</button>
    </header>
    <div class="obs-modal-body">
      ${
        isEmpty
          ? `<p class="obs-empty">Open a few sky objects and they will appear here — a quiet diary of your evening.</p>`
          : renderSessionPreview(session!)
      }
      ${
        !isEmpty
          ? `
        <label class="obs-checkbox">
          <input type="checkbox" data-include-gps />
          <span>Include exact GPS coordinates in the export</span>
        </label>
        <textarea class="obs-notes" placeholder="A short note about the evening (optional)…"></textarea>
        <pre class="obs-export" aria-live="polite"></pre>
        <div class="obs-actions">
          <button type="button" class="btn btn-primary" data-copy>Copy</button>
          ${
            ctx.user
              ? `<button type="button" class="btn btn-outline" data-save>Save to account</button>`
              : `<a class="btn btn-outline" href="#/account" data-stuff-nav>Sign in to save</a>`
          }
          <button type="button" class="btn btn-ghost" data-clear>Start new</button>
        </div>
        <div class="obs-status" aria-live="polite"></div>
      `
          : ""
      }
      ${
        ctx.user
          ? `<a class="obs-history-link" href="#/observations">View saved observations →</a>`
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
      status.textContent = "Copied — paste into your notes app.";
    } catch {
      status.textContent = "Could not copy — long-press to select instead.";
    }
  });

  modal.querySelector("[data-save]")?.addEventListener("click", async () => {
    status.textContent = "Saving…";
    const result = await saveSessionToAccount(session!);
    status.textContent = result.ok
      ? "Saved to your account."
      : `Could not save${result.error ? `: ${result.error}` : ""}.`;
  });

  modal.querySelector("[data-clear]")?.addEventListener("click", () => {
    if (!confirm("Start a fresh observing session?")) return;
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
  const place = session.region ?? "your location";
  const start = new Date(session.startedAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `
    <p class="obs-summary">
      <strong>${count}</strong> object${count === 1 ? "" : "s"} viewed since ${start}
      from ${place}.
    </p>
  `;
}

// ── History view (route: #/observations) ─────────────────────────

export async function renderObservations(
  container: HTMLElement,
  ctx: AppContext,
): Promise<void> {
  container.innerHTML = "";
  renderHeader(container, ctx);
  renderNav("#/account");

  const title = document.createElement("h3");
  title.className = "section-title";
  title.textContent = "Saved observations";
  container.appendChild(title);

  if (!ctx.user) {
    const note = document.createElement("p");
    note.className = "muted-prose";
    note.innerHTML = `Sign in to keep a quiet record of your evenings across devices. <a href="#/account" class="wiki-link">Sign in →</a>`;
    container.appendChild(note);
    return;
  }

  const loading = document.createElement("p");
  loading.className = "muted-prose";
  loading.textContent = "Loading…";
  container.appendChild(loading);

  const history = await fetchObservationHistory();
  loading.remove();

  if (history.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted-prose";
    empty.textContent =
      "Nothing saved yet. Open Observations from the Stuff menu after an evening's browsing to keep a record.";
    container.appendChild(empty);
    return;
  }

  const list = document.createElement("div");
  list.className = "obs-history";
  for (const item of history) {
    list.appendChild(
      renderHistoryItem(item, () => renderObservations(container, ctx)),
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
  card.innerHTML = `
    <header class="obs-history-head">
      <div>
        <div class="obs-history-date">${date}</div>
        <div class="obs-history-meta">${start}–${end} · ${item.region ?? "location not recorded"} · ${item.entryCount} object${item.entryCount === 1 ? "" : "s"}</div>
      </div>
      <button type="button" class="obs-history-del" aria-label="Delete">×</button>
    </header>
    <ul class="obs-history-list">
      ${item.entries
        .slice(0, 12)
        .map(
          (e) =>
            `<li><a href="#/detail/${e.id}" class="wiki-link">${e.name}</a></li>`,
        )
        .join("")}
      ${item.entries.length > 12 ? `<li class="obs-history-more">+${item.entries.length - 12} more</li>` : ""}
    </ul>
  `;
  card
    .querySelector(".obs-history-del")
    ?.addEventListener("click", async () => {
      if (!confirm("Delete this observation?")) return;
      const ok = await deleteObservation(item.id);
      if (ok) onChange();
    });
  return card;
}
