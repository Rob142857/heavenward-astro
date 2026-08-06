import type { AppContext } from "../types.js";
import { fetchUser, logout } from "../services/api.js";
import { renderHeader, renderNav } from "./layout.js";
import { t } from "../i18n/translations.js";

export function renderAccount(container: HTMLElement, ctx: AppContext): void {
  container.innerHTML = "";
  renderHeader(container, ctx);
  renderNav("#/account");

  const title = document.createElement("h3");
  title.className = "section-title";
  title.textContent = t("nav.account");
  container.appendChild(title);

  if (ctx.user) {
    renderLoggedIn(container, ctx);
  } else {
    renderLoggedOut(container, ctx);
  }
}

function renderLoggedIn(container: HTMLElement, ctx: AppContext): void {
  const card = document.createElement("div");
  card.className = "card";
  card.style.cursor = "default";
  card.innerHTML = `
    <div class="card-title">${ctx.user!.name}</div>
    <div class="card-brief">${t("account.emailProvider", { email: ctx.user!.email, provider: ctx.user!.provider })}</div>
  `;
  container.appendChild(card);

  const obsLink = document.createElement("a");
  obsLink.className = "btn btn-outline btn-block";
  obsLink.textContent = t("account.savedObservations");
  obsLink.href = "#/observations";
  obsLink.style.textDecoration = "none";
  obsLink.style.textAlign = "center";
  obsLink.style.marginBottom = "8px";
  container.appendChild(obsLink);

  const logoutBtn = document.createElement("button");
  logoutBtn.className = "btn btn-outline btn-block";
  logoutBtn.textContent = t("account.signOut");
  logoutBtn.addEventListener("click", async () => {
    await logout();
    ctx.user = null;
    renderAccount(container, ctx);
  });
  container.appendChild(logoutBtn);
}

function renderLoggedOut(container: HTMLElement, _ctx: AppContext): void {
  const googleBtn = document.createElement("a");
  googleBtn.className = "btn btn-primary btn-block";
  googleBtn.textContent = t("account.signInWithGoogle");
  googleBtn.href = "/auth/google";
  googleBtn.style.marginBottom = "8px";
  googleBtn.style.textDecoration = "none";
  googleBtn.style.textAlign = "center";
  container.appendChild(googleBtn);

  const msBtn = document.createElement("a");
  msBtn.className = "btn btn-outline btn-block";
  msBtn.textContent = t("account.signInWithMicrosoft");
  msBtn.href = "/auth/microsoft";
  msBtn.style.textDecoration = "none";
  msBtn.style.textAlign = "center";
  container.appendChild(msBtn);

  const note = document.createElement("p");
  note.style.cssText =
    "font-size:0.75rem;color:var(--text-dim);margin-top:16px;text-align:center;";
  note.textContent = t("account.syncNote");
  container.appendChild(note);
}

export async function tryLoadUser(ctx: AppContext): Promise<void> {
  // Only attempt API call if there's a sign user might be logged in
  // The session cookie is httpOnly so we can't read it, but we can
  // skip the call on first visit by checking localStorage
  if (!localStorage.getItem("heavenward-has-session")) return;
  try {
    const res = await fetchUser();
    if (res.ok && res.data) ctx.user = res.data;
  } catch {
    // not logged in — clear the hint
    localStorage.removeItem("heavenward-has-session");
  }
}
