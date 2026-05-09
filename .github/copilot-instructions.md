# Heavenward

## Stack
Vite 8 · TypeScript 6 (strict, ESM) · Hono · Cloudflare Pages + D1/KV · astronomy-engine · vanilla TS DOM · vite-plugin-pwa

## Layout
```
src/types.ts        shared interfaces (CelestialEvent, GeoLocation, ApiResponse)
src/main.ts         entry: GPS → router → initial render
src/engine/         astronomy-engine wrappers (pure functions)
src/catalog/        static JSON + TS types: DSO, stars, meteors
src/services/       geolocation, localStorage, API client
src/ui/             DOM views, hash router, styles.css
src/chart/          Canvas finder chart
functions/api/      Hono API (user prefs, API key CRUD)
functions/auth/     OAuth handlers (Google/Microsoft PKCE)
functions/middleware/ auth guard, CORS
public/             icons, manifest, index.html
```

## Data Flow
Astronomy computation is **client-only** (src/engine). The Workers API handles auth, user preferences, and API key CRUD — no ephemeris on the server.

## Rules
- Pure functions. No classes unless stateful. No `any` — use `unknown` + guards
- All engine functions: `(GeoLocation, Date) → typed result | null`
- Universal shape: `CelestialEvent` with `extra: Record<string, unknown>` for LLM metadata
- API responses: `{ ok: boolean, data?: T, error?: string }`
- D1 queries always parameterized. No string interpolation in SQL
- Dark theme: bg `#0a0e1a`, text `#e0e6f0`, accent `#4fc3f7`
- Mobile-first, 44px min touch targets, single column cards
- No Node.js APIs in Workers — Web APIs only

## Commands
```sh
npm run dev       # Vite dev server
npm run build     # tsc --noEmit + vite build
npm run preview   # wrangler pages dev dist
npm run deploy    # build + wrangler pages deploy dist
```

## Agent Behavior
- Read before write. Understand existing code before changing it
- Batch independent edits with multi_replace_string_in_file
- Use grep_search/file_search over terminal commands for file discovery
- No markdown docs unless asked. No docstrings on unchanged code
- No speculative error handling. Validate only at system boundaries
- When stuck, check .github/instructions/ for scoped rules before asking
