import "./ui/styles.css";
import type { AppContext } from "./types.js";
import { requestGPS, getSavedLocation } from "./services/geolocation.js";
import { loadPrefs } from "./services/prefs.js";
import { navigate, route, startRouter } from "./ui/router.js";
import { renderTonight } from "./ui/tonight.js";
import {
  renderDetail,
  renderDSODetail,
  renderStarDetail,
  restoreBreadcrumb,
} from "./ui/detail.js";
import { renderSources } from "./ui/sources.js";
import { renderLocation } from "./ui/location.js";
import { renderAccount, tryLoadUser } from "./ui/account.js";
import { renderAbout } from "./ui/about.js";
import { renderObservations } from "./ui/observations.js";
import { renderSearch } from "./ui/search.js";
import { initAnalytics } from "./services/analytics.js";
import { initPWA } from "./services/pwa.js";
import { isSocialInAppBrowser } from "./services/browser.js";

const DEFAULT_LOCATION = { lat: 51.48, lon: -0.01, elev: 0 }; // Greenwich

initPWA();

async function boot(): Promise<void> {
  const app = document.getElementById("app");
  if (!app) return;

  // Render immediately. Some in-app browsers delay or block geolocation,
  // which otherwise prevents the twilight bar from appearing at all.
  const savedLocation = getSavedLocation();
  const location = savedLocation ?? DEFAULT_LOCATION;

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
  route("/search", () => renderSearch(app, ctx));
  route("/about", () => renderAbout(app, ctx));
  route("/about/sources", () => renderAbout(app, ctx, "sources"));
  route("/observations", () => {
    void renderObservations(app, ctx);
  });

  startRouter();

  if (!savedLocation && !isSocialInAppBrowser()) {
    requestGPS()
      .then((loc) => {
        ctx.location = loc;
        navigate(window.location.hash || "#/");
      })
      .catch(() => {
        // Keep the already-rendered fallback location visible.
      });
  }
}

boot();

// Dismiss the inline boot splash once the app has mounted its first view.
// We poll until #app has content — boot() may await GPS (up to 10 s) before
// the first render lands, so we must NOT force-dismiss on a fixed timer or
// we leave a blank screen between splash hide and first paint.
function dismissBootSplash(): void {
  const splash = document.getElementById("boot-splash");
  if (!splash) return;
  splash.classList.add("hide");
  window.setTimeout(() => splash.remove(), 400);
}
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    const app = document.getElementById("app");
    if (app && app.children.length > 0) {
      dismissBootSplash();
      return;
    }
    // Poll until #app has content. If boot() catastrophically fails the
    // splash stays visible — better than a blank dark page.
    const tick = (): void => {
      if (app && app.children.length > 0) {
        dismissBootSplash();
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
});
