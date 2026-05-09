---
description: "Use when working with star catalogs, DSO data, meteor shower calendars, satellite TLEs, or any static astronomical dataset"
applyTo: "src/catalog/**"
---
# Catalog Data Conventions

- All catalogs are typed JSON arrays, imported statically
- Each catalog entry must include: `id`, `name`, `ra` (hours), `dec` (degrees), `magnitude`
- DSO catalog: subset of OpenNGC (mag ≤ 12, ~3000 objects) in `src/catalog/dso.json`
- Bright stars: HYG subset (mag ≤ 6, ~9000 stars) in `src/catalog/stars.json`
- Meteor showers: IMO calendar as `src/catalog/meteors.json` — includes name, peak date, ZHR, radiant RA/Dec
- Each catalog has a typed wrapper: `dso.ts` exports `DSOEntry`, `stars.ts` exports `StarEntry`, `meteors.ts` exports `MeteorShower`
- Large catalogs (stars 9k, DSO 3k) use dynamic `import()` for code-splitting; meteors (small) can be static
- At runtime, filter by: magnitude limit, altitude > 0, and user-enabled data sources
- `extra` field on `CelestialEvent` carries catalog-specific metadata (type, size, surface brightness)
