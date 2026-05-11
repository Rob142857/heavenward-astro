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

export function navigate(hash: string, state?: unknown): void {
  const url = hash.startsWith("#") ? hash : `#${hash}`;
  const currentHash = window.location.hash || "#/";
  // Avoid pushing duplicate entries for the same route
  if (currentHash === url && !state) {
    doRoute?.();
    return;
  }
  history.pushState(state ?? null, "", url);
  doRoute?.();
}

export function startRouter(): void {
  history.scrollRestoration = "manual";

  doRoute = () => {
    const hash = window.location.hash.slice(1) || "/";
    for (const r of routes) {
      const match = hash.match(r.pattern);
      if (match) {
        const params: Record<string, string> = {};
        match.slice(1).forEach((v, i) => {
          params[`p${i}`] = v;
        });
        window.scrollTo(0, 0);
        r.handler(params);
        return;
      }
    }
    // fallback to home
    if (hash !== "/") {
      navigate("#/");
    }
  };
  window.addEventListener("popstate", doRoute);
  window.addEventListener("hashchange", doRoute);
  doRoute();
}
