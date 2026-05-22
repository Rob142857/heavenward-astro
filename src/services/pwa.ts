import { registerSW } from "virtual:pwa-register";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

let initialized = false;
let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
let installSurface: HTMLElement | null = null;
let installButton: HTMLButtonElement | null = null;
let dismissButton: HTMLButtonElement | null = null;
let activeRegistration: ServiceWorkerRegistration | null = null;
let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | null =
  null;
let updateModal: HTMLElement | null = null;
let updateInProgress = false;
let reloadScheduled = false;

const INSTALL_SNOOZE_KEY = "heavenward-install-snoozed-until";
const INSTALL_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const UPDATE_RELOAD_DELAY_MS = 1200;

export function initPWA(): void {
  if (initialized) return;
  initialized = true;

  updateServiceWorker = registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      activeRegistration = registration ?? null;
      registration?.update().catch(() => {});
      if (registration?.waiting && navigator.serviceWorker.controller) {
        beginUpdateRefresh();
      }
      if (registration) {
        window.setInterval(() => {
          registration.update().catch(() => {});
        }, UPDATE_CHECK_INTERVAL_MS);
      }
    },
    onNeedRefresh() {
      beginUpdateRefresh();
    },
    onRegisterError(error) {
      console.warn("[PWA] Service worker registration failed", error);
    },
    onOfflineReady() {
      console.info("[PWA] Offline cache is ready");
    },
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      scheduleUpdateReload();
    });
  }

  window.addEventListener("online", () => {
    activeRegistration?.update().catch(() => {});
  });

  window.addEventListener("beforeinstallprompt", (event: Event) => {
    event.preventDefault();
    deferredInstallPrompt = event as BeforeInstallPromptEvent;
    updateInstallSurface();
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    localStorage.removeItem(INSTALL_SNOOZE_KEY);
    updateInstallSurface();
  });
}

export function bindInstallPrompt(
  surface: HTMLElement,
  button: HTMLButtonElement,
  dismiss: HTMLButtonElement,
): void {
  installSurface = surface;
  installButton = button;
  dismissButton = dismiss;

  installButton.addEventListener("click", () => {
    promptInstall().catch(() => {});
  });

  dismissButton.addEventListener("click", () => {
    snoozeInstallPrompt();
  });

  updateInstallSurface();
}

function isInstalled(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as unknown as { standalone?: boolean }).standalone)
  );
}

function updateInstallSurface(): void {
  if (!installSurface || !installButton || !dismissButton) return;
  const shouldShow =
    Boolean(deferredInstallPrompt) && !isInstalled() && !isSnoozed();
  installSurface.hidden = !shouldShow;
  installButton.disabled = !shouldShow;
  dismissButton.disabled = !shouldShow;
}

async function promptInstall(): Promise<void> {
  if (!deferredInstallPrompt) return;
  const promptEvent = deferredInstallPrompt;
  deferredInstallPrompt = null;
  updateInstallSurface();
  await promptEvent.prompt();
  const choice = await promptEvent.userChoice.catch(() => ({
    outcome: "dismissed" as const,
    platform: "",
  }));
  if (choice.outcome === "dismissed") {
    snoozeInstallPrompt();
  }
}

function snoozeInstallPrompt(): void {
  localStorage.setItem(
    INSTALL_SNOOZE_KEY,
    String(Date.now() + INSTALL_SNOOZE_MS),
  );
  updateInstallSurface();
}

function isSnoozed(): boolean {
  const raw = localStorage.getItem(INSTALL_SNOOZE_KEY);
  if (!raw) return false;
  const snoozedUntil = Number(raw);
  if (!Number.isFinite(snoozedUntil) || snoozedUntil <= Date.now()) {
    localStorage.removeItem(INSTALL_SNOOZE_KEY);
    return false;
  }

  return true;
}

function beginUpdateRefresh(): void {
  if (updateInProgress) return;
  updateInProgress = true;
  showUpdateModal();

  if (updateServiceWorker) {
    updateServiceWorker(true).catch(() => {
      scheduleUpdateReload();
    });
    return;
  }

  activeRegistration?.waiting?.postMessage({ type: "SKIP_WAITING" });
  window.setTimeout(() => {
    scheduleUpdateReload();
  }, UPDATE_RELOAD_DELAY_MS);
}

function scheduleUpdateReload(): void {
  if (reloadScheduled) return;
  reloadScheduled = true;
  showUpdateModal();
  window.setTimeout(() => {
    window.location.reload();
  }, UPDATE_RELOAD_DELAY_MS);
}

function showUpdateModal(): void {
  if (updateModal) return;

  const modal = document.createElement("div");
  modal.className = "app-update-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "app-update-title");
  modal.tabIndex = -1;
  modal.innerHTML = `
    <div class="app-update-dialog">
      <div class="app-update-spinner" aria-hidden="true"></div>
      <div class="app-update-copy">
        <strong id="app-update-title">Retrieving The Latest Sky</strong>
        <p>We are loading the latest astronomical observations and sky information. Thanks for your patience.</p>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  document.body.classList.add("app-update-lock");
  updateModal = modal;
  requestAnimationFrame(() => {
    modal.classList.add("visible");
    modal.focus({ preventScroll: true });
  });
}
