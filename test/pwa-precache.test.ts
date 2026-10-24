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

test("AI sky guide runtime (~12 MB) stays out of the precache and is cached on first use", () => {
  const cfg = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
  const line = cfg.split("\n").find((l) => l.includes("globIgnores:")) ?? "";
  assert.ok(line.includes('"assets/lib-*.js"'), "lib chunk must be ignored by the precache");
  assert.ok(line.includes('"assets/webllm-worker-*.js"'), "WebLLM worker must be ignored by the precache");
  assert.ok(cfg.includes('cacheName: "ai-runtime"'), "ignored AI chunks need a runtime cache");
});

test("manifest: a separate maskable icon exists and differs from the 'any' icon", () => {
  const cfg = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
  const m = /src: "(\/icons\/[^"]+)",\s*sizes: "512x512",\s*type: "image\/png",\s*purpose: "maskable"/.exec(cfg);
  assert.ok(m, "a 512px maskable icon must be declared");
  assert.notEqual(m[1], "/icons/icon-512.png", "maskable must not reuse the 'any' icon");
  const png = readFileSync(new URL(`../public${m[1]}`, import.meta.url));
  assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(png.readUInt32BE(16), 512, "maskable icon width");
  assert.equal(png.readUInt32BE(20), 512, "maskable icon height");
});

test("robots.txt is a real file (not the SPA fallback) and keeps crawlers off the API", () => {
  const txt = readFileSync(new URL("../public/robots.txt", import.meta.url), "utf8");
  assert.match(txt, /^User-agent: \*/m);
  assert.match(txt, /^Disallow: \/api\//m);
});
