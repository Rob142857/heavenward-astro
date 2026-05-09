---
description: "Use when writing Cloudflare Workers, Pages Functions, Hono API routes, wrangler config, D1 queries, KV operations, or auth handlers"
applyTo: "functions/**"
---
# Cloudflare Workers / Pages Functions

- Use Hono framework: `import { Hono } from 'hono'`
- Each file in `functions/` auto-maps to a route (Pages Functions convention)
- Access bindings via `c.env.BINDING_NAME` (D1, KV, secrets)
- D1 queries: `c.env.DB.prepare(sql).bind(...params).all()` — always parameterized, never interpolate
- KV: `c.env.USER_PREFS.get(key)`, `.put(key, value, { expirationTtl })`
- Auth secrets in `.dev.vars` locally, Cloudflare dashboard in production
- Response shape: `c.json({ ok: true, data })` or `c.json({ ok: false, error: msg }, status)`
- No Node.js APIs (no `fs`, `path`, `crypto` module) — use Web APIs and `crypto.subtle`
- Workers have 10ms CPU limit (free) / 30s (paid). Keep handlers fast
- Large computation belongs in client-side `src/engine/`, not Workers

## Auth Flow
- PKCE OAuth2: client redirects → `/auth/google` or `/auth/microsoft` → callback exchanges code
- JWT issued in httpOnly secure SameSite=Strict cookie (not localStorage)
- Auth guard middleware validates JWT on protected routes via `crypto.subtle.verify`
- Silent re-auth on token expiry; no refresh tokens stored server-side

## Route Map
```
GET  /auth/google          redirect to Google OAuth
GET  /auth/google/callback  exchange code → set JWT cookie
GET  /auth/microsoft        redirect to Microsoft OAuth
GET  /auth/microsoft/callback
POST /auth/logout           clear cookie
GET  /api/user              current user profile
GET  /api/prefs             user preferences (sources, location)
PUT  /api/prefs             update preferences
POST /api/keys              create API key
DELETE /api/keys/:id        revoke API key
```

## Middleware
- `functions/middleware/auth.ts` — JWT validation, attaches `c.set('user', payload)`
- CORS: allow same origin only for cookie auth; API-key routes allow cross-origin
