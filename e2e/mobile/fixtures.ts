import { test as base, expect, type Page } from "@playwright/test";

// 20:30 AEDT on 18 Oct 2026: after dusk in Sydney, so Tonight renders the
// night view and every run computes the same sky.
export const FIXED_NOW = new Date("2026-10-18T09:30:00Z");

/** Matches the invented geolocation in playwright.config.ts. */
export const TEST_GEO = { latitude: -31.4, longitude: 147.9 };

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

/**
 * Keep runs offline and deterministic: nothing leaves the machine.
 * Known third parties get a harmless empty answer; anything else is aborted
 * and recorded so a new outbound call shows up in the test output.
 */
async function isolateNetwork(page: Page, blocked: string[]): Promise<void> {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (LOCAL_HOSTS.has(url.hostname)) {
      // No Workers API under the Vite dev server: answer as signed out.
      if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) {
        return route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: "signed out (test stub)" }),
        });
      }
      return route.continue();
    }
    blocked.push(url.host);
    if (/open-meteo|swpc\.noaa\.gov/.test(url.hostname)) {
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
    return route.abort("blockedbyclient");
  });
}

type Fixtures = {
  consoleErrors: string[];
  blockedHosts: string[];
};

export const test = base.extend<Fixtures>({
  blockedHosts: async ({}, use) => {
    await use([]);
  },
  // Auto: every test gets the frozen clock and the offline network, even if
  // it never reads consoleErrors.
  consoleErrors: [async ({ page, blockedHosts }, use) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      // Our own stubs: blocked third parties and the signed-out API answer.
      if (/ERR_BLOCKED_BY_CLIENT|blockedbyclient/i.test(text)) return;
      if (/status of 401/.test(text)) return;
      errors.push(text);
    });
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
    await page.clock.setFixedTime(FIXED_NOW);
    await isolateNetwork(page, blockedHosts);
    await use(errors);
  }, { auto: true }],
});

export { expect };

/** Waits for the boot splash to go and a view to mount in #app. */
export async function gotoApp(page: Page, hash = "#/"): Promise<void> {
  await page.goto(`/${hash}`);
  await expect(page.locator("#app > *").first()).toBeAttached();
  await expect(page.locator("#boot-splash")).toHaveCount(0, { timeout: 15_000 });
}

/** True when the document is wider than the viewport (sideways scroll). */
export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/**
 * Lists visible controls in `selector` smaller than `min` CSS px on either
 * side. Returns a readable description per offender.
 */
export async function smallTapTargets(
  page: Page,
  selector: string,
  min = 44,
): Promise<string[]> {
  return page.$$eval(
    selector,
    (els, min) =>
      els
        .filter((el) => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
        })
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { el, w: Math.round(r.width), h: Math.round(r.height) };
        })
        .filter(({ w, h }) => w < min || h < min)
        .map(({ el, w, h }) => {
          const label =
            el.getAttribute("aria-label") ||
            (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 30) ||
            el.className;
          return `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} "${label}" ${w}x${h}`;
        }),
    min,
  );
}

/**
 * Approximates an on-screen keyboard: keeps the width, shrinks the layout
 * viewport to `fraction` of its height. Real Android Chrome resizes the
 * layout viewport like this (resizes-content); iOS Safari only shrinks the
 * visual viewport, which this cannot model exactly.
 */
export async function openVirtualKeyboard(page: Page, fraction = 0.55): Promise<{ width: number; height: number }> {
  const vp = page.viewportSize();
  if (!vp) throw new Error("no viewport");
  const shrunk = { width: vp.width, height: Math.round(vp.height * fraction) };
  await page.setViewportSize(shrunk);
  return shrunk;
}

/**
 * Is at least the top `minVisiblePx` of the element on screen? Measures
 * against the visual viewport (what the user actually sees), not
 * window.innerHeight, which mobile Chrome inflates when a page is wider than
 * the screen.
 */
export async function isInViewport(
  page: Page,
  selector: string,
  minVisiblePx = 24,
): Promise<boolean> {
  return page.$eval(
    selector,
    (el, minVisiblePx) => {
      const r = el.getBoundingClientRect();
      const vv = window.visualViewport;
      const top = vv ? vv.offsetTop : 0;
      const bottom = top + (vv ? vv.height : window.innerHeight);
      const visible = Math.min(r.bottom, bottom) - Math.max(r.top, top);
      return visible >= Math.min(minVisiblePx, r.height);
    },
    minVisiblePx,
  );
}
