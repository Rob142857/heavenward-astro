import "./ui/styles.css";
import type { AppContext } from "./types.js";
import {
  requestGPS,
  getSavedLocation,
  firstLocationAsk,
  markLocationConfirmed,
} from "./services/geolocation.js";
import { loadPrefs } from "./services/prefs.js";
import {
  navigate,
  replaceHash,
  reroute,
  route,
  startRouter,
} from "./ui/router.js";
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
import { renderSearch, resolveObjectId } from "./ui/search.js";
import { initAnalytics, trackInsight } from "./services/analytics.js";
import { initPWA } from "./services/pwa.js";
import { isSocialInAppBrowser } from "./services/browser.js";
import { initI18n } from "./i18n/i18n.js";
import { parseSkyLink } from "./services/deep-link.js";

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
  // A previously saved location is the user's own; only the Greenwich
  // fallback leaves this unconfirmed, and the UI says so when it is.
  if (savedLocation) markLocationConfirmed();

  const ctx: AppContext = {
    location,
    prefs: loadPrefs(),
    user: null,
  };

  // Deep link from another app (e.g. Trip Companion's "Open in Sky"):
  // place and time for this visit only. Nothing is saved over the user's
  // own location. The params stay in the address bar (the router keeps them
  // across in-app navigation), so a reload, share or bookmark keeps the same
  // place and time. "Use my sky now" removes them.
  const link = parseSkyLink(window.location.search);
  if (link.location) {
    ctx.location = link.location;
    ctx.linkedLocation = true;
    markLocationConfirmed();
  }
  if (link.at) {
    ctx.at = link.at;
    ctx.atZone = link.zone;
  }

  // Try to load user profile (non-blocking)
  tryLoadUser(ctx);

  // Start analytics
  initAnalytics();

  // Register routes
  route("/", () => renderTonight(app, ctx));

  const showDetail = (id: string): void => {
    restoreBreadcrumb();
    if (id.startsWith("dso-")) {
      renderDSODetail(app, ctx, id);
    } else if (id.startsWith("star-")) {
      renderStarDetail(app, ctx, id);
    } else {
      renderDetail(app, ctx, id);
    }
  };
  route("/detail/:id", (params) => showDetail(params.p0));

  // Name-based object links for people and agents: #/object/M42,
  // #/object/lmc, #/object/ngc%20292, #/object/jupiter. Resolved with the
  // search aliases; an unknown name opens search prefilled with it.
  route("/object/:name", (params) => {
    const raw = params.p0;
    let name = raw;
    try {
      name = decodeURIComponent(raw);
    } catch {
      /* keep the raw text */
    }
    const routeHash = window.location.hash;
    void resolveObjectId(name).then((id) => {
      if (window.location.hash !== routeHash) return; // navigated away
      if (id) {
        showDetail(id);
      } else {
        replaceHash(`#/search?q=${encodeURIComponent(name)}`);
        renderSearch(app, ctx);
      }
    });
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
  trackInsight("app_ready");

  // Request GPS with timeout for better UX
  if (ctx.linkedLocation) {
    // The link chose the place; do not ask for GPS over it.
  } else if (!savedLocation && !isSocialInAppBrowser()) {
    // Only use GPS by itself when the person already allowed it. Otherwise no
    // permission prompt on load: the header shows "Set your location" and the
    // Location screen asks on a tap (Rob, 25 Oct 2026; Lighthouse flags
    // geolocation-on-start).
    void geolocationAlreadyGranted().then((granted) => {
      if (!granted) {
        // First open with no location: show the Location screen once instead
        // of a default (Greenwich) sky. Deep links to other pages are left alone.
        const home = window.location.hash === "" || window.location.hash === "#/";
        if (home && firstLocationAsk()) replaceHash("#/location");
        reroute();
        return;
      }
      requestGPS()
        .then((loc) => {
          ctx.location = loc;
          reroute();
        })
        .catch(() => {
          console.log("[GPS] Using saved or fallback location");
        });
    });
  } else if (!savedLocation) {
    console.log("[GPS] Waiting for timeout");
    setTimeout(() => {
      console.log("[GPS] Fallback: rendering without GPS");
      reroute();
    }, 1000);
  }
}

/** True only when the browser reports geolocation as already granted (never prompts). */
export async function geolocationAlreadyGranted(): Promise<boolean> {
  try {
    if (!navigator.permissions?.query) return false;
    const status = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    return status.state === "granted";
  } catch {
    return false;
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
