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

export function navigate(hash: string): void {
  window.location.hash = hash;
}

export function startRouter(): void {
  const onHash = () => {
    const hash = window.location.hash.slice(1) || "/";
    for (const r of routes) {
      const match = hash.match(r.pattern);
      if (match) {
        const params: Record<string, string> = {};
        match.slice(1).forEach((v, i) => {
          params[`p${i}`] = v;
        });
        r.handler(params);
        return;
      }
    }
    // fallback to home
    if (hash !== "/") {
      window.location.hash = "#/";
    }
  };
  window.addEventListener("hashchange", onHash);
  onHash();
}
