/** Semantic observations only; the shared SDK handles opt-outs and tab sessions. */
export function trackInsight(event: string): void {
  window.dispatchEvent(new CustomEvent("rme:insight", { detail: { event } }));
}

/** Preserve the two existing object-click call sites without sending their values. */
export function trackEvent(event: string, _path: string, _detail?: string): void {
  if (event === "click") trackInsight("object_open");
}

export function initAnalytics(): void {
  // Page categories, engagement and navigation are handled by /insights.js.
  // Legacy /api/event remains readable for historical reports; no duplicate sends.
}
