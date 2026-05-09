import "./ui/styles.css";
import type { AppContext } from "./types.js";
import { requestGPS, getSavedLocation } from "./services/geolocation.js";
import { loadPrefs } from "./services/prefs.js";
import { route, startRouter } from "./ui/router.js";
import { renderTonight } from "./ui/tonight.js";
import { renderDetail, renderDSODetail, renderStarDetail, restoreBreadcrumb } from "./ui/detail.js";
import { renderSources } from "./ui/sources.js";
import { renderLocation } from "./ui/location.js";
import { renderAccount, tryLoadUser } from "./ui/account.js";
import { renderAbout } from "./ui/about.js";
import { initAnalytics, trackEvent } from "./services/analytics.js";
import { registerSW } from "virtual:pwa-register";

const DEFAULT_LOCATION = { lat: 51.48, lon: -0.01, elev: 0 }; // Greenwich

// Auto-reload when a new service worker activates
const updateSW = registerSW({
  onNeedRefresh() {
    updateSW(true);
  },
  onOfflineReady() {
    // silently ready for offline
  },
});

async function boot(): Promise<void> {
  const app = document.getElementById("app");
  if (!app) return;

  // Resolve location: saved → GPS → fallback
  let location = getSavedLocation();
  if (!location) {
    try {
      location = await requestGPS();
    } catch {
      location = DEFAULT_LOCATION;
    }
  }

  const ctx: AppContext = {
    location,
    prefs: loadPrefs(),
    user: null,
  };

  // Try to load user profile (non-blocking)
  tryLoadUser(ctx);

  // Start analytics
  initAnalytics();

  // Register routes
  route("/", () => renderTonight(app, ctx));

  route("/detail/:id", (params) => {
    const id = params.p0;
    restoreBreadcrumb();
    if (id.startsWith("dso-")) {
      renderDSODetail(app, ctx, id);
    } else if (id.startsWith("star-")) {
      renderStarDetail(app, ctx, id);
    } else {
      renderDetail(app, ctx, id);
    }
  });

  route("/sources", () => renderSources(app, ctx));
  route("/location", () => renderLocation(app, ctx));
  route("/account", () => renderAccount(app, ctx));
  route("/about", () => renderAbout(app, ctx));

  startRouter();
}

boot();
