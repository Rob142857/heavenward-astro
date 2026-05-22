<p align="center">
  <img src="public/icons/icon-192.png" alt="Heavenward" width="96" height="96">
</p>

<h1 align="center">Heavenward</h1>

<p align="center"><strong>Is tonight worth a warm jacket and a cup of tea?</strong></p>

<p align="center">
  <a href="https://sky.incitat.io"><strong>sky.incitat.io</strong></a>
</p>

Heavenward answers the question every stargazer asks at dusk: _what's up there right now that's worth heading outside for?_ It checks your location, works out what's visible tonight, and tells you plainly — planets, the Moon, galaxies, nebulae, meteor showers, eclipses, conjunctions — all computed live in your browser with sub-arcsecond precision. No star-chart puzzles. No date pickers. Just open it and see.

---

## What you'll see

- **Tonight view** — everything above (and below) your horizon, sorted by brightness, altitude, or angular size
- **Twilight bar** — sunset → civil/nautical/astronomical dusk → dark sky hours → dawn → sunrise, collapsible
- **Planets** — Mercury through Neptune with rise/set/transit, magnitude, phase, distance, constellation
- **Moon** — illumination, phase, libration, distance, next quarters
- **Deep-sky objects** — hundreds of galaxies, nebulae, and clusters from the Messier, Caldwell, and NGC/IC catalogs, with surface brightness, imaging notes, and morphology
- **Stars** — named and navigational stars with spectral type, colour index, double/variable flags, and exoplanet data
- **Meteor showers** — active showers with ZHR, speed, radiant position, and parent body
- **Eclipses & conjunctions** — upcoming events with geometry and timing
- **Finder chart** — canvas-rendered star field with crosshair, FOV indicator, and magnitude labels
- **Sky images** — Wikimedia Commons astrophotography with attribution, falling back to NASA SkyView DSS2 survey plates
- **AI sky guide** — optional on-device LLM (via WebLLM + WebGPU) generates conversational guides to any region of the sky — observing tips, fascinating facts, Wikipedia links, photography advice. Runs entirely in your browser. No data leaves your device.
- **Equipment filters** — Naked Eye / Personal Telescope / Observatory presets with magnitude limiting
- **Category filters** — Solar System · Milky Way · Beyond, toggled independently
- **Sort** — Brightest, Highest, Lowest, Smallest
- **GPS location** — auto-detect or enter coordinates manually
- **Source toggles** — enable/disable individual data sources
- **Offline-capable** — service worker + Workbox precaching; works without a connection after first load
- **Dark theme** — true-dark UI (#0a0e1a) designed for night-time use without ruining your dark adaptation

## Stack

| Layer     | Technology                                                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Frontend  | TypeScript 6 (strict ESM) · vanilla DOM · Vite 8 · vite-plugin-pwa                                                                  |
| Astronomy | [astronomy-engine](https://github.com/cosinekitty/astronomy) by [Don Cross](https://github.com/cosinekitty) — client-side ephemeris |
| AI        | [WebLLM](https://github.com/mlc-ai/web-llm) by [MLC AI](https://mlc.ai/) — on-device inference via WebGPU                           |
| API       | [Hono](https://hono.dev) on Cloudflare Pages Functions                                                                              |
| Auth      | Google & Microsoft OAuth 2.0 PKCE                                                                                                   |
| Storage   | Cloudflare D1 (users, API keys) · KV (preferences)                                                                                  |

## Project layout

```
src/
  types.ts          Shared interfaces (CelestialEvent, GeoLocation, etc.)
  main.ts           Entry: GPS → router → initial render
  engine/           astronomy-engine wrappers (pure functions)
  catalog/          Static JSON + types: DSO, stars, meteor showers
  services/         Geolocation, localStorage, API client, LLM, analytics
  ui/               DOM views, hash router, styles.css
  chart/            Canvas finder chart
functions/
  api/              Hono API (user prefs, API key CRUD)
  auth/             OAuth handlers (Google/Microsoft PKCE)
  middleware/       Auth guard, CORS
public/             Icons, manifest, index.html
```

## Quick start

```sh
npm install
npm run dev          # Vite dev server on localhost:5173
```

## Commands

| Command                  | Description                                          |
| ------------------------ | ---------------------------------------------------- |
| `npm run dev`            | Start Vite dev server                                |
| `npm run build`          | Type-check + production build                        |
| `npm run preview`        | Local preview via Wrangler                           |
| `npm run deploy`         | Build + deploy to Cloudflare Pages production branch |
| `npm run deploy:preview` | Build + deploy a non-production preview branch       |
| `npm run catalog:plan`   | Print catalog import plan (sources, outputs, validation) without downloading |
| `npm run refresh`        | Run catalog importers (pass `-- --stars` or `-- --dso` to scope) |

## How it works

All astronomy computation runs **client-side** — the server never sees your coordinates or computes any ephemeris. The Cloudflare Workers API handles authentication, user preferences, and API key management only.

Every astronomical object maps to a universal `CelestialEvent` shape with an `extra: Record<string, unknown>` field for source-specific metadata. Engine functions are pure: `(GeoLocation, Date) → typed result`. No classes unless stateful. No `any`.

The Tonight view lazily computes rise/set times per (object, day) on demand for displayed cards only, keeping the initial render fast even with thousands of catalog entries.

## Catalog refresh pipeline

Catalogs that ship with the app are checked in as JSON or TypeScript so the runtime stays offline-friendly. Use `npm run catalog:plan` to inspect source URLs, transform steps, output files, and validation rules without downloading anything.

### Bright stars (scripted)

- **Source** — HYG v4.2, filtered to bright stars, enriched with human-readable notes for major landmarks
- **Output** — `src/catalog/stars.json`
- **Command** — `npm run refresh -- --stars`
- **Validation** — reject rows without numeric RA/Dec/visual magnitude; dedupe by proper-name slug or HR identifier; round to stable precision for reproducible diffs

### Deep-sky objects (scripted)

- **Source** — OpenNGC, filtered for observable magnitudes, normalized into Heavenward's typed DSO shape, enriched for showpiece objects
- **Output** — `src/catalog/dso.json`
- **Command** — `npm run refresh -- --dso`
- **Validation** — reject rows without coordinates or visual/blue magnitude; dedupe by normalized Messier or catalog identifier; round to stable precision

### Meteor showers (manual)

- **Source** — curated TypeScript table cross-checked against IMO annual guidance
- **Output** — `src/catalog/meteors.ts`
- **Command** — manual review today; a `npm run refresh -- --meteors` parser is planned
- **Validation** — keep coordinates in RA hours and Dec degrees to match engine helpers

## Data sources & acknowledgements

Heavenward is built on the work of generous open-source contributors and public scientific datasets:

- **[astronomy-engine](https://github.com/cosinekitty/astronomy)** — Don Cross's dependency-free ephemeris library powers all planetary positions, rise/set times, lunar phases, eclipses, and conjunctions
- **[WebLLM](https://github.com/mlc-ai/web-llm)** — MLC AI's runtime for local LLM inference via WebGPU
- **DSO catalog** — drawn from the Messier, Caldwell, and select NGC/IC objects; physical data from the NGC/IC Project and CDS VizieR
- **Bright Star Catalogue** — Yale BSC with IAU star names, spectral classifications, and exoplanet cross-references
- **IAU Meteor Data Center & IMO** — shower activity windows, ZHR rates, velocities, and radiant coordinates
- **[NASA SkyView](https://skyview.gsfc.nasa.gov/)** — DSS2 survey images for finder chart views
- **[Wikimedia Commons](https://commons.wikimedia.org/)** — astrophotography under Creative Commons licenses

## Privacy

Your GPS location is used only for calculations and **never leaves your device**. All computation runs client-side. The optional AI model also runs entirely in your browser via WebGPU — no cloud, no tracking.

## Deploy your own

<p align="center">
  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/Rob142857/heavenward-astro"><img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare"></a>
</p>

## License

Copyright 2024-2026 Rob142857

Licensed under the Apache License, Version 2.0 — see [LICENSE](LICENSE) for details.

You must retain attribution notices when redistributing this software or derivative works. See [NOTICE](NOTICE) for required attributions.
