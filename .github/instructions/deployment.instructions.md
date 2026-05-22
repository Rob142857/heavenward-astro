---
description: "Use when deploying Heavenward, changing deploy scripts, checking Cloudflare Pages branches, or debugging PWA/domain freshness"
applyTo: "{package.json,wrangler.toml,vite.config.ts,public/_headers,public/_redirects}"
---

# Heavenward Deployment Rules

- Production is the Cloudflare Pages `production` branch. Do not use `main` for production deploys.
- Use `npm run deploy` or `npm run deploy:production`; both must deploy with `wrangler pages deploy dist --branch production`.
- Use `npm run deploy:preview` only for non-production checks; preview deploys must not be treated as live `sky.incitat.io` updates.
- After deploying, verify branch and environment with `wrangler pages deployment list --project-name heavenward`.
- Verify the custom domain with a no-cache request to `https://sky.incitat.io/about`, plus `https://sky.incitat.io/sw.js` when PWA freshness is in question.
- If installed PWAs do not update, first confirm the latest deployment is `Environment: Production`, `Branch: production`, then check `_headers`, `sw.js`, and the app-shell asset hash.
