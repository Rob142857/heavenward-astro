import { defineConfig, devices } from "@playwright/test";

// Mobile emulation suite. Run with `pnpm test:mobile`; refresh baselines with
// `pnpm test:mobile:update`. Agent guide (local to Rob's PC):
// C:\Users\RobertEvans\Agents\shared\mobile-testing.md

const PORT = 4317;

// An invented point in inland NSW. Not anyone's address.
const TEST_GEO = { latitude: -31.4, longitude: 147.9 };

const shared = {
  timezoneId: "Australia/Sydney",
  locale: "en-AU",
  geolocation: TEST_GEO,
  permissions: ["geolocation"],
  reducedMotion: "reduce" as const,
  // The PWA service worker would cache responses past our route stubs.
  serviceWorkers: "block" as const,
};

export default defineConfig({
  testDir: "e2e/mobile",
  outputDir: "test-results/mobile",
  snapshotPathTemplate:
    "{testDir}/__screenshots__/{platform}/{projectName}/{arg}{ext}",
  fullyParallel: true,
  workers: 4,
  retries: 0,
  timeout: 45_000,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report/mobile", open: "never" }],
  ],
  expect: {
    // The dev server serves ~5 MB of catalogue JSON to four workers at once;
    // the first search or sky report can take more than the 5 s default.
    timeout: 15_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      threshold: 0.25,
      animations: "disabled",
      caret: "hide",
      scale: "css",
    },
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...shared,
  },
  projects: [
    { name: "pixel-7", use: { ...devices["Pixel 7"], ...shared } },
    { name: "galaxy-s24", use: { ...devices["Galaxy S24"], ...shared } },
    { name: "iphone-14", use: { ...devices["iPhone 14"], ...shared } },
    {
      name: "desktop-chrome",
      use: { ...devices["Desktop Chrome"], ...shared },
    },
  ],
  webServer: {
    command: `pnpm exec vite --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
