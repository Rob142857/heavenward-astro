const SESSION_KEY = "heavenward-sid";

function getSessionId(): string {
  let sid = sessionStorage.getItem(SESSION_KEY);
  if (!sid) {
    sid = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, sid);
  }
  return sid;
}

/** Fire-and-forget event log to /api/event */
export function trackEvent(
  event: string,
  path: string,
  detail?: string,
): void {
  const body = JSON.stringify({
    sid: getSessionId(),
    event,
    path,
    detail: detail ?? null,
  });
  // Use sendBeacon for reliability on unload, fall back to fetch
  if (navigator.sendBeacon) {
    navigator.sendBeacon("/api/event", new Blob([body], { type: "application/json" }));
  } else {
    fetch("/api/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  }
}

/** Track page views on hash change */
export function initAnalytics(): void {
  trackEvent("pageview", window.location.hash || "#/");
  window.addEventListener("hashchange", () => {
    trackEvent("pageview", window.location.hash || "#/");
  });
}
