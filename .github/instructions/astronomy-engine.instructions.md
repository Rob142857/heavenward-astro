---
description: "Use when writing or modifying astronomy computation code, ephemeris calculations, rise/set times, altitude/azimuth, coordinate transforms, or any astronomy-engine API usage"
applyTo: "src/engine/**"
---
# Astronomy Engine Rules

- Import as `import * as Astronomy from 'astronomy-engine'`
- Observer: `new Astronomy.Observer(lat, lon, elevMeters)`
- All dates as JS `Date` (UTC). astronomy-engine accepts `FlexibleDateTime`
- Rise/set: `SearchRiseSet(body, obs, direction, startDate, limitDays)` — direction +1=rise, -1=set
- Twilight: `SearchAltitude('Sun', obs, direction, date, limitDays, altitude)` — civil=-6, nautical=-12, astro=-18
- Always return `Date | null`, never throw on missing rise/set (polar regions)
- Magnitude via `Illumination(body, date).mag`
- Constellation: `Constellation(ra, dec).name`
- Horizontal coords: `Horizon(date, obs, ra, dec, 'normal')` — returns `{ altitude, azimuth }`
- For DSOs: use `getAltAzForRaDec(ra, dec, loc, date)` — no body enum needed
- Normalize everything to `CelestialEvent` interface from `src/types.ts`
- `CelestialEvent`, `GeoLocation`, `TwilightTimes` are defined in `src/types.ts` and re-exported from `src/engine/astro.ts`
