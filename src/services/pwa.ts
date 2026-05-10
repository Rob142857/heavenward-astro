import { registerSW } from "virtual:pwa-register";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

let initialized = false;
let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
let installButton: HTMLButtonElement | null = null;

export function initPWA(): void {
  if (initialized) return;
  initialized = true;

  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      registration?.update().catch(() => {});
    },
    onRegisterError(error) {
      console.warn("[PWA] Service worker registration failed", error);
    },
    onOfflineReady() {
      console.info("[PWA] Offline cache is ready");
    },
  });

  window.addEventListener("beforeinstallprompt", (event: Event) => {
    event.preventDefault();
    deferredInstallPrompt = event as BeforeInstallPromptEvent;
    updateInstallButton();
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    updateInstallButton();
  });
}

export function bindInstallButton(button: HTMLButtonElement): void {
  installButton = button;
  installButton.addEventListener("click", () => {
    promptInstall().catch(() => {});
  });
  updateInstallButton();
}

function isInstalled(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as unknown as { standalone?: boolean }).standalone);
}

function updateInstallButton(): void {
  if (!installButton) return;
  installButton.hidden = !deferredInstallPrompt || isInstalled();
}

async function promptInstall(): Promise<void> {
  if (!deferredInstallPrompt) return;
  const promptEvent = deferredInstallPrompt;
  deferredInstallPrompt = null;
  updateInstallButton();
  await promptEvent.prompt();
  await promptEvent.userChoice.catch(() => ({ outcome: "dismissed" as const, platform: "" }));
}