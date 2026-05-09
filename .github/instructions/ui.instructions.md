---
description: "Use when building UI components, DOM rendering, views, page navigation, dark theme, mobile layout, or PWA install prompts"
applyTo: "src/ui/**"
---
# UI Conventions

- Vanilla TypeScript DOM manipulation — no React/Vue/Svelte
- Dark theme by default: background `#0a0e1a`, text `#e0e6f0`, accent `#4fc3f7`
- Mobile-first: single column, full-width cards, large touch targets (min 44px)
- Views render to a `#app` container via `innerHTML` or DOM construction
- Simple hash router: `#/`, `#/detail/{id}`, `#/sources`, `#/location`
- Location shown as small text in header bar, tappable to change
- Data sources page: toggle switches for each source, persisted in localStorage
- Finder chart: `<canvas>` element, drawn by `src/chart/` module
- SkyView images: `https://skyview.gsfc.nasa.gov/current/cgi/runquery.pl?Position={ra},{dec}&Survey=DSS2+Red&Size=0.5&Pixels=300&Return=PNG`
- Lazy-load images; show placeholder skeleton while loading

## Boot Sequence
`main.ts`: import styles → request GPS (fallback to stored location) → init hash router → render `#/` tonight view

## Views
- `#/` — tonight: twilight bar + sorted event cards
- `#/detail/{id}` — event detail + finder chart + SkyView image
- `#/sources` — toggle data sources (persisted in localStorage)
- `#/location` — change location (GPS or manual lat/lon)
- `#/account` — sign in / profile / API keys

## View Lifecycle
Each view exports `render(container: HTMLElement, ctx: AppContext): void` and optional `cleanup(): void`

## CSS
Single `src/ui/styles.css` imported in `main.ts`. Theme via CSS custom properties (`--bg`, `--text`, `--accent`)

## State
No global store. Location from GPS/localStorage passed to engine; results flow down to views as arguments
