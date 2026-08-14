const SESSION_KEY = "heavenward-sid";

function getSessionId(): string {
  let sid = sessionStorage.getItem(SESSION_KEY);
  if (!sid) {
    sid = crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, sid);
  }
  return sid;
}

interface EventPayload {
  sid: string;
  event: string;
  path: string;
  detail: string | null;
  dwell_ms?: number;
  referrer?: string;
  tz?: string;
}

function send(payload: EventPayload): void {
  const body = JSON.stringify(payload);
  if (navigator.sendBeacon) {
    navigator.sendBeacon(
      "/api/event",
      new Blob([body], { type: "application/json" }),
    );
  } else {
    fetch("/api/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  }
}

/** Fire-and-forget event log to /api/event */
export function trackEvent(event: string, path: string, detail?: string): void {
  send({
    sid: getSessionId(),
    event,
    path,
    detail: detail ?? null,
  });
}

// ── Dwell tracking ──────────────────────────────────────
let currentPath = "";
let pageEnterTs = 0;

function flushDwell(): void {
  if (!currentPath || !pageEnterTs) return;
  const dwell = Date.now() - pageEnterTs;
  pageEnterTs = 0;
  if (dwell < 250) return; // ignore instant nav
  send({
    sid: getSessionId(),
    event: "dwell",
    path: currentPath,
    detail: null,
    dwell_ms: dwell,
  });
}

function recordPageview(path: string): void {
  flushDwell();
  currentPath = path;
  pageEnterTs = Date.now();
  let tz: string | undefined;
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    tz = undefined;
  }
  send({
    sid: getSessionId(),
    event: "pageview",
    path,
    detail: null,
    referrer: document.referrer || undefined,
    tz,
  });
}

/** Track page views + dwell + nav activity */
export function initAnalytics(): void {
  recordPageview(window.location.hash || "#/");

  window.addEventListener("hashchange", () => {
    recordPageview(window.location.hash || "#/");
  });
  // Normal in-app navigation uses history.pushState(), which emits no native
  // hashchange. router.ts publishes this event after updating the URL.
  window.addEventListener("app:navigate", () => {
    recordPageview(window.location.hash || "#/");
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushDwell();
    } else if (document.visibilityState === "visible") {
      pageEnterTs = Date.now();
    }
  });
  window.addEventListener("pagehide", flushDwell);
  window.addEventListener("beforeunload", flushDwell);
}
