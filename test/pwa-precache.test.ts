import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// One 404 in the precache list fails the whole service-worker install.
// Cloudflare Pages config files are never served, so they must stay out.
test("service worker precache ignores Cloudflare Pages config files", () => {
  const cfg = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
  const line = cfg.split("\n").find((l) => l.includes("globIgnores:")) ?? "";
  for (const f of ["_routes.json", "_headers", "_redirects"]) {
    assert.ok(line.includes(`"${f}"`), `${f} must be in workbox.globIgnores`);
  }
});
