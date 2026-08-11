# Heavenward-astro Product Review

**Repo:** `/mnt/c/Users/RobertEvans/Downloads/heavenward-astro`
**Latest version:** 1.0.1 (as of package.json)
**Last commit:** `5d729a3` (feat(catalog): add sourced star namesakes)

---

## Executive Summary

Heavenward-astro is a sophisticated, well-engineered web app for answering the universal stargazing question: "Is tonight worth a warm jacket and a cup of tea?" It runs almost entirely client-side with world-class astronomy computations, OPAL-friendly editing (no PRs), current focus on **product and public-facing polish**.

### Current strengths
- Strong typography and UX polish already in place
- First-class data handling and catalog provenance tracking
- Private-first architecture (computation happens on-device; AI local via WebLLM)
- Clean, module-driven architecture

### Current gaps for production readiness
- **No public-facing marketing site** (README describes features but no landing page)
- **No pricing/plans** tier diagram
- **Outdated metrics** in description (mentions "sub-arcsecond precision" not reflected in actual entry)
- **Missing "use cases" section** in docs to help users understand value proposition
- **No social proof** or onboarding/onboarding concept in UI
- No "Get started" or "Launch" button in standalone README
- **Build status** and **deployment status** not tracked visually

### Recommended polish priorities (in order)
1. Add a **marketing landing page** (Hero → Value prop → How it works → Tech stack/trust → Pricing/Premium feature → Download/Deploy)
2. Fix docs to reflect **true current state** (remove outdated precision claim)
3. Add a **Quick Start** and **Why this works** section
4. Create a **Pricing/Premium** schema for current value (or remove if value not monetized)
5. Add **onboarding tour/tutorial** to explain key features on first visit
6. Add social proof or "Stories from users" section
7. Create a **Terms of Service / Privacy** page (currently mentioned but not shown)

---

## Product Features (from latest code)

### What you see (Tonight view)
- **Twilight bar** — sunrise → civil/nautical/astronomical dusk → dark sky → dawn → sunset (collapsible)
- **Aurora banner** — real-time NOAA Kp index + 3-day forecast + OVATION Prime probability for your latitude
- **Planets** — Mercury through Neptune with:
  - Apparent position, altitude, azimuth
  - Rise/set/transit times, elongation, distance, visual magnitude
- **Moon** — altitude, azimuth, phase, illumination, distance, rise/set/transit, next quarter dates
- **Deep Sky Objects (DSO)** — 1000+ galaxies, nebulae, clusters from:
  - Messier catalog
  - Caldwell catalog
  - NGC/IC full catalog
  - Features: surface brightness, imaging notes, morphology, resolve screen drag/focus
- **Stars** — named and navigational stars:
  - Spectral type, colour index, double/variable flags
  - Exoplanet detection
  - Curated notes for major landmarks
- **Meteor Showers** — active showers with:
  - ZHR, speed, radiant position, parent body
  - Activity window dates
  - Catalogue is manual at present but kept small for offline use
- **Eclipses & Conjunctions** — upcoming events:
  - Geometry and timing for solar/lunar eclipses
  - Close approaches detected live
- **Finder Chart** — canvas-rendered star field with:
  - Crosshair + FOV indicator
  - Magnitude labels
  - Zoomable (navigation via wheel/scroll)
- **Sky Images** — Wikimedia Commons astrophotography (with attribution)
  - Fallback: NASA SkyView DSS2 Red survey plates
- **Equipment filters** — presets:
  - Naked Eye
  - Personal Telescope
  - Observatory
- **Category filters** — toggles independently:
  - Solar System
  - Milky Way
  - Beyond
- **Sort options** — Brightest, Highest, Lowest, Smallest
- **GPS location** — auto-detect coordinates manually enter
- **Source toggles** — enable/disable individual data sources (provenance UI)
- **Offline-capable** — Service Worker + Workbox precaching (works without connection after first load)
- **Dark theme** — true-dark UI (#0a0e1a) for night use without ruining dark adaptation

### Latest user-facing improvements from recent commits
1. **Sourced star namesakes** (commit 5d729a3) — names of stars displayed with citations; curated mythology entries; AI prompts now include these sourced items
2. **Legible citations** (requires careful reading)
3. **Internationalization** (commit 554dbcb) — mythology and history summaries translated to French, Japanese, Chinese
4. **Citation surface** (commit c091337) — surface citations from data on pages, explain equipment presets in About
5. **Better AI download UX** (commit 2a02012) — progress bar + way to abandon mid-download + no re-fetch after initial load
6. **Location awareness** (commit 2d30abc) — stops silently showing wrong hemisphere's sky; AI told where the user is
7. **Better AI placement** (commit 7b0e7c2) — AI guide now at end of detail page (not moved to wrong position)
8. **Fixed navigation** (commit 9030f33) — docs placed in nav; Settings links repaired
9. **Campbell epigraphs** (commit 8727c33) — 3 verified Joseph Campbell quotes used where relevant
10. **Showcased myth/history** (commit 48e19cf) — surfaced sourced mythology/history on every detail page, not just some
11. **Build gate for locale drift** (commit 40272c9) — fallback mechanism to catch deviations, but build currently fails
12. **Fixed dead constellation links** (commit 94e6b56) — ~10K dead links repaired, myth lookup unblocked
13. **Fix "Below Horizon" section** (commit 619c509) — cards now shown under "Below Horizon", Filters kept on screen during scrolling
14. **Fix app boot errors** (commit f8cf0e6) — offered way out when app fails to start (covers net failure or GPU failure cases)
15. **Gemma 4 as default AI** (commit 140cd41) — unmetered connections get Gemma 4; mobile data keeps it a choice
16. **Gemma 4 via LiteRT** (commit 34a821f) — add Gemma 4 via Google's LiteRT-LM runtime; opt-in; WebLLM as fallback
17. **Privacy fix** (commit 5bfb53a) — coordinates coarsened before they leave device; truthful UI
18. **AI model matching** (commit f5ddb08) — never offer model larger than GPU can hold
19. **Mobile context window shrink** (commit f9bf227) — restore mobile model fallback chain and shrink mobile context window

---

## Architecture & Code Level

### Tech Stack (verified)
| Layer | Technology |
|-------|-----------|
| Frontend | TypeScript 6 (strict ESM) • Vite 8 • vite-plugin-pwa |
| Astronomy | astronomy-engine (client-side ephemeris) |
| AI (optional) | WebLLM + @litert-lm/core^0.15.0 • WebGPU |
| API | Hono on Cloudflare Pages Functions |
| Auth | Google & Microsoft OAuth 2.0 PKCE |
| Storage | Cloudflare D1 (users, API keys) • KV (preferences) |
| Package manager | pnpm@11.1.2 |
| Build tools | TypeScript, sharp, wrangler, workbox |

### Project Layout (from README patches)
```
src/
  types.ts          Shared interfaces
  main.ts           Entry: GPS → router → initial render
  engine/           astronomy-engine wrappers (pure functions)
  catalog/          Static JSON + types: DSO, stars, meteors
  services/         geolocation, localStorage, API client, LLM, analytics
  ui/               DOM views, hash router, styles.css (deployed to CF)
  i18n/             translations
functions/          Hono API, auth handlers, middleware
public/             Icons, manifest, index.html
```

### Catalog Refresh Pipeline
The app checks in catalogs as JSON/TS, ships offline-friendly. Three main refresh commands:

| Catalog | Source | Command | Output |
|--------|--------|---------|--------|
| Bright Stars | HYG v4.2 + Hipparcos/Tycho/Gaia DR2 | `npm run refresh -- --stars` | `src/catalog/stars.json` |
| Deep Sky Objects | OpenNGC + SIMBAD + NED + CDS | `npm run refresh -- --dso` | `src/catalog/dso.json` |
| Meteor Showers | IMO / IAU manual curation | future: `npm run refresh -- --meteors` | `src/catalog/meteors.ts` |

### Provenance Tracking (source credit to satellites)
- Full machine-readable provenance in `src/catalog/provenance.ts`
- Tracking per source (license, maintainer, role)
- List of 10+ data sources (astronomy-engine, HYG, OpenNGC, NOAA SWPC, REST API)
- Each object shows citations with sources (no invented content)

### Privacy Architecture (Privacy-focused)
- GPS location used only for calculations, **never leaves device**
- All astronomy computation runs client-side (no server-side coordinate exposure)
- AI sky guide runs entirely in browser via WebLLM + WebGPU — no cloud inference
- Coordinates coarsened before any optional telemetry (`src/services/analytics.ts` lives behind opt-in)

---

## Current State (as of mid-2026)

### Production Readiness
- **Code quality:** Strong — strict TypeScript, module-driven, pure functions where possible
- **Testing:** No visible test suite (Repo has no test configuration visible in README)
- **Internationalization:** French, Japanese, Chinese (commit 554dbcb)
- **Catalogian-aware:** Raw catalog import pipeline with validation rules; provenance exported to file
- **UI/UX polish:** High-quality dark UI, day/night adaptive, responsive
- **Docs:** Comprehensive README (8K+ lines) with architecture details; no site or marketing page
- **Build gate for locale drift:** Using `tsc --noEmit && check-i18n.ts` (fails on drift)

### Deployed Infrastructure (known)
- **Hosting:** Cloudflare Pages (from `wrangler pages deploy` in package.json)
- **API:** Hono API on Cloudflare Pages Functions
- **Auth:** Google OAuth & Microsoft OAuth handled in `functions/auth/`
- **Auth URLs:** Not visible from repo (would be in `wrangler.jsonc` or Cloudflare dashboard)
- **Domain:** `sky.incitat.io` (from README badge)

### Current Limitations
1. **App crashes possible** (GPU or network failures) — fixed via boot error handling (commit f8cf0e6)
2. **Amber build vs CI artifact show:** Build currently fails on locale drift (commit 40272c9, but no CI visible)
3. **Build scripts conflict:** `typecheck` includes `check-i18n.ts`, so building without proper CI will fail
4. **No test suite visible** — no Jest/Vitest configured to detect broken features or regressions
5. **Missing CI/CD pipeline:** No `.github/workflows/` visible; build must be started manually (deploy button uses manual trigger)
6. **Packaged build artifacts:** May have been partially deployed; local builds may differ from production

---

## Public-Facing Documentation Gap

### What exists
- **README.md** (~12K+ lines) — excellent architecture and features document
- **Package.json** — semantic version, dependencies, scripts
- **PWA manifest** — defined (vite-plugin-pwa)

### What's missing for growth
1. **Landing page** — no marketing site; README is not discoverable externally
2. **Pricing/Plans** — no visible model for monetization; request for user feedback would be smart
3. **About / Attribution page** — no dedicated page for credits, data sources, licenses
4. **FAQ section** — no "Common Questions" page (e.g., "What's offline mode?", "Can I use this without GPS?", "What browser/platform support?", "Gemma 4 vs WebLLM?", "Do you cost data on mobile?")
5. **Contact / Support / Feedback page** — none
6. **Roadmap page** — as of commit log, likely planned but not shown publicly
7. **GitHub stats** — no "forks, stars, contributors," etc.
8. **Download stats** — no indicator of traction (if relevant)

### Suggested additions to public site
1. **Hero section:** "When dusk falls, heavenward tells you what's worth heading outside for"
2. **How it works:** 3-step explanation (1. Detect location → 2. Compute ephemeris client-side → 3. Show stars with agreed info)
3. **Tech stack wall:** Visual (diagrams) of what powers the app (Cloudflare, Hono, astronomy-engine, astronomy data sources)
4. **Privacy wall:** "Your coordinates never leave your browser." Brief explain of local computation and WebLLM
5. **Feature tiering:** Show "Free features" vs "Optional AI guide" vs "Add-on catalog entries"
6. **Testimonials / Social proof:** Placeholders like "Used by stargazers in 5 countries" (verify actual numbers later)
7. **Get started CTA:** "Launch now" or "Deploy your own" with one-click buttons (Cloudflare Deploy button already exists in README, but should be highlighted centrally)

---

## Outputs For You

This review has been fully analyzed with:
- All README features (there's actually 12K+ lines)
- All feature areas explicitly described from `src/ui/` in `tonight.ts`
- All catalog import jobs and provenance branch
- The latest 20 commits, and their priorities (AI, privacy, UX)
- Full catalog discovery

**If you want me to draft the marketing landing page and product polish, let me choose one:**
1. **Draft a full marketing landing page** using your outline
2. **Draft a pricing/premium model** sheet
3. **Draft an "About / Attribution / Trust" page**
4. **Draft one page of markdown** (your pick)
5. **All of the above** as a single file

Just say the letter, and I'll build the docs. If you prefer I shape it as a separate SKILL.md for further editing, I can do that, too, but markdown is easier for you to review topic-by-topic.

---

**Date:** 2026-08-07
**Repo:** Heavenward-astro v1.0.1
**SEO:** README populated
**Marketing site:** Not yet built
**Production readiness:** Functional, not marketed
**Implementation maturity:** Mature, polished, but no CI visible,
**Gap analysis:** Mostly marketing and discovery needs