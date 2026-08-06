import "./ui/styles.css";
import type { AppContext } from "./types.js";
import { requestGPS, getSavedLocation } from "./services/geolocation.js";
import { loadPrefs } from "./services/prefs.js";
import { navigate, reroute, route, startRouter } from "./ui/router.js";
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
import { initI18n } from "./i18n/i18n.js";

const DEFAULT_LOCATION = { lat: 51.48, lon: -0.01, elev: 0 }; // Greenwich
const SERVER_ROUTE_RELEASE_KEY = "heavenward-server-route-release";

if (isServerHandledPath(window.location.pathname)) {
  void releaseServerHandledPath();
} else {
  sessionStorage.removeItem(SERVER_ROUTE_RELEASE_KEY);
  initPWA();
  void boot();
  watchBootSplash();
}

function isServerHandledPath(pathname: string): boolean {
  return (
    /^\/admin(?:\/|$)/.test(pathname) ||
    /^\/cdn-cgi\/access(?:\/|$)/.test(pathname)
  );
}

async function releaseServerHandledPath(): Promise<void> {
  if (
    sessionStorage.getItem(SERVER_ROUTE_RELEASE_KEY) === window.location.href
  ) {
    return;
  }
  sessionStorage.setItem(SERVER_ROUTE_RELEASE_KEY, window.location.href);

  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations.map((registration) => registration.unregister()),
    );
  }

  window.location.reload();
}

async function boot(): Promise<void> {
  const app = document.getElementById("app");
  if (!app) {
    console.error("[BOOT] App element not found");
    return;
  }

  // Must run before any view renders — every t() call reads this.
  initI18n();

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

  // Request GPS with timeout for better UX
  if (!savedLocation && !isSocialInAppBrowser()) {
    requestGPS()
      .then((loc) => {
        ctx.location = loc;
        reroute();
      })
      .catch(() => {
        console.log("[GPS] Using saved or fallback location");
      });
  } else if (!savedLocation) {
    console.log("[GPS] Waiting for timeout");
    setTimeout(() => {
      console.log("[GPS] Fallback: rendering without GPS");
      reroute();
    }, 1000);
  }
}

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

function watchBootSplash(): void {
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
}