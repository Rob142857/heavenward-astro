# ☆ Heavenward

**Dusk-till-dawn astronomical event report — everything visible tonight, one tap away.**

Heavenward is a mobile-first PWA that computes what's in your sky right now: planets, the Moon, deep-sky objects, meteor showers, eclipses, and conjunctions — all calculated client-side with sub-arcsecond precision.

**Live:** [heavenward.pages.dev](https://heavenward.pages.dev)

---

## Features

- **Tonight view** — sorted by visibility and brightness, with altitude/azimuth at a glance
- **Twilight bar** — sunset, civil/nautical/astronomical dusk & dawn, dark-sky hours
- **Planets** — Mercury through Neptune: rise/set/transit, magnitude, illumination, constellation
- **Moon** — phase, libration, distance, illumination percentage, next quarters
- **Deep-sky objects** — Messier and NGC catalog with magnitude filtering for your equipment
- **Meteor showers** — active showers with ZHR, radiant position, and parent body
- **Eclipses & conjunctions** — upcoming lunar/solar eclipses and planetary events
- **Finder chart** — canvas-rendered star chart with crosshair and FOV indicator
- **SkyView integration** — DSS2 survey images for every cataloged object
- **GPS location** — auto-detect or enter coordinates manually
- **Source toggles** — enable/disable data sources, set magnitude limits
- **Offline-capable** — service worker + precaching via Workbox
- **Dark theme** — true-dark UI designed for night-time use without ruining dark adaptation

## Stack

| Layer     | Technology                                                                           |
| --------- | ------------------------------------------------------------------------------------ |
| Frontend  | TypeScript 6 (strict ESM) · vanilla DOM · Vite 8                                     |
| Astronomy | [astronomy-engine](https://github.com/cosinekitty/astronomy) — client-side ephemeris |
| API       | [Hono](https://hono.dev) on Cloudflare Pages Functions                               |
| Auth      | Google & Microsoft OAuth 2.0 PKCE                                                    |
| Storage   | Cloudflare D1 (users, API keys) · KV (preferences)                                   |
| PWA       | vite-plugin-pwa · Workbox precaching                                                 |

## Project layout

```
src/
  types.ts          Shared interfaces (CelestialEvent, GeoLocation, etc.)
  main.ts           Entry: GPS → router → initial render
  engine/           astronomy-engine wrappers (pure functions)
  catalog/          Static JSON: DSO, stars, meteor showers
  services/         Geolocation, localStorage, API client
  ui/               DOM views, hash router, styles
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

| Command           | Description                        |
| ----------------- | ---------------------------------- |
| `npm run dev`     | Start Vite dev server              |
| `npm run build`   | Type-check + production build      |
| `npm run preview` | Local preview via Wrangler         |
| `npm run deploy`  | Build + deploy to Cloudflare Pages |

## Architecture

All astronomy computation runs **client-side** — no ephemeris on the server. The Workers API handles authentication, user preferences, and API key management only.

Every astronomical object maps to a universal `CelestialEvent` shape with an `extra: Record<string, unknown>` field for extensible metadata.

## License

Copyright 2024-2026 Rob142857

Licensed under the Apache License, Version 2.0 — see [LICENSE](LICENSE) for details.

You must retain attribution notices when redistributing this software or derivative works. See [NOTICE](NOTICE) for required attributions.
