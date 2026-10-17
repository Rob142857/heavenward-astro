type RouteHandler = (params: Record<string, string>) => void;

const routes: { pattern: RegExp; handler: RouteHandler }[] = [];

export function route(path: string, handler: RouteHandler): void {
  const paramNames: string[] = [];
  const pattern = path.replace(/:(\w+)/g, (_, name) => {
    paramNames.push(name);
    return "([^/]+)";
  });
  routes.push({
    pattern: new RegExp(`^${pattern}$`),
    handler: (params) => handler(params),
  });
}

let doRoute: (() => void) | null = null;

/** The hash route without its own `?query` (e.g. `/search?q=m42` → `/search`). */
export function splitHashRoute(hash: string): { path: string; query: string } {
  const i = hash.indexOf("?");
  return i < 0
    ? { path: hash, query: "" }
    : { path: hash.slice(0, i), query: hash.slice(i + 1) };
}

/** Query params carried inside the hash (`#/search?q=nebula`). */
export function hashQuery(): URLSearchParams {
  return new URLSearchParams(splitHashRoute(window.location.hash.slice(1)).query);
}

export function navigate(hash: string, state?: unknown): void {
  const url = hash.startsWith("#") ? hash : `#${hash}`;
  const currentPath = cleanPathname(window.location.pathname);
  const currentHash = window.location.hash || (currentPath === "/" ? "#/" : "");
  // Keep the page's ?query (a deep link's lat/lng/date/time/tz) on every
  // in-app navigation, so the linked place and time survive reload and share.
  const target = url.startsWith("#/") ? `/${window.location.search}${url}` : url;
  // Avoid pushing duplicate entries for the same route
  if (currentHash === url && !state) {
    // pushState (below) fires no native event, so anything that must react
    // to an in-app navigation — e.g. aborting an AI generation in progress —
    // subscribes to this instead of hashchange/popstate.
    window.dispatchEvent(new Event("app:navigate"));
    doRoute?.();
    return;
  }
  history.pushState(state ?? null, "", target);
  window.dispatchEvent(new Event("app:navigate"));
  doRoute?.();
}

/** Replace the hash without a new history entry or a re-render. */
export function replaceHash(hash: string): void {
  const url = hash.startsWith("#") ? hash : `#${hash}`;
  history.replaceState(history.state, "", `${window.location.pathname}${window.location.search}${url}`);
}

export function reroute(): void {
  doRoute?.();
}

export function startRouter(): void {
  history.scrollRestoration = "manual";

  doRoute = () => {
    const raw =
      window.location.hash.slice(1) || cleanPathname(window.location.pathname);
    const { path, query } = splitHashRoute(raw);
    for (const r of routes) {
      const match = path.match(r.pattern);
      if (match) {
        const params: Record<string, string> = {};
        match.slice(1).forEach((v, i) => {
          params[`p${i}`] = v;
        });
        params.query = query;
        window.scrollTo(0, 0);
        r.handler(params);
        return;
      }
    }
    // fallback to home
    if (path !== "/") {
      history.replaceState(null, "", `/${window.location.search}#/`);
      doRoute?.();
    }
  };
  window.addEventListener("popstate", doRoute);
  window.addEventListener("hashchange", doRoute);
  doRoute();
}

function cleanPathname(pathname: string): string {
  if (!pathname || pathname === "/") return "/";
  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}
