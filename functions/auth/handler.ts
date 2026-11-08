import { Hono } from "hono";
import { parseCookie, signJWT } from "../middleware/auth.ts";
import { b64url, randomId, safeReturnTo } from "../mcp/oauth.ts";

interface Env {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  MICROSOFT_CLIENT_ID: string;
  MICROSOFT_CLIENT_SECRET: string;
  JWT_SECRET: string;
  DB: D1Database;
}

const ALLOWED_ORIGIN = "sky.incitat.io";

const auth = new Hono<{ Bindings: Env }>();

/** Extract CF geo + IP for login audit */
function extractGeo(c: {
  req: { raw: Request; header: (k: string) => string | undefined };
}): {
  ip: string | null;
  country: string | null;
  city: string | null;
} {
  const ip =
    c.req.header("CF-Connecting-IP") ??
    c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ??
    null;
  const cf = (c.req.raw as Request & { cf?: Record<string, unknown> }).cf ?? {};
  return {
    ip,
    country: typeof cf.country === "string" ? cf.country : null,
    city: typeof cf.city === "string" ? cf.city : null,
  };
}

/** Check whether a user is allowed to log in. Returns null if OK, else reason. */
async function checkUserStatus(
  db: D1Database,
  userId: string,
): Promise<string | null> {
  const row = await db
    .prepare("SELECT status FROM users WHERE id = ?")
    .bind(userId)
    .first<{ status: string | null }>();
  const status = row?.status ?? "active";
  if (status === "blocked" || status === "banned") return status;
  return null;
}

/** Record a successful login: update users row, emit canonical login event. */
async function recordLogin(
  db: D1Database,
  userId: string,
  geo: { ip: string | null; country: string | null; city: string | null },
  ua: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE users SET
         last_login_at = ?,
         last_login_ip = ?,
         last_login_country = ?,
         last_login_city = ?,
         login_count = COALESCE(login_count, 0) + 1
       WHERE id = ?`,
    )
    .bind(now, geo.ip, geo.country, geo.city, userId)
    .run();
  await db
    .prepare(
      `INSERT INTO events (session_id, user_id, event, path, detail, ua, ip, country, city, ts)
       VALUES (?, ?, 'login', '/auth', NULL, ?, ?, ?, ?, ?)`,
    )
    .bind(
      `login-${userId}-${now}`,
      userId,
      ua,
      geo.ip,
      geo.country,
      geo.city,
      now,
    )
    .run();
}

function blockedPage(status: string): Response {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Access blocked</title>
<style>body{background:#0a0e1a;color:#e0e6f0;font-family:-apple-system,sans-serif;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center}
.card{background:#111827;border:1px solid #1e2a42;border-radius:14px;max-width:420px;padding:28px}
h1{color:#f5e6a3;margin-bottom:8px}
p{color:#7b869c;font-size:.9rem;line-height:1.5}</style></head>
<body><div class="card"><h1>Account ${status}</h1><p>Your Heavenward account is currently ${status}. If you believe this is an error, contact support.</p></div></body></html>`;
  return new Response(html, {
    status: 403,
    headers: { "Content-Type": "text/html;charset=utf-8" },
  });
}

// ── Sign-in state ───────────────────────────────────────
// A random `state` ties each provider callback to the browser that started
// it (login CSRF), and carries where to go afterwards (e.g. back to the MCP
// consent page). Host-only cookie, 10 minutes, sent back on the provider's
// top-level redirect because it is SameSite=Lax.

const STATE_COOKIE = "auth_state";

function startState(returnTo: string | undefined): { state: string; cookie: string } {
  const state = randomId(16);
  const back = b64url(new TextEncoder().encode(safeReturnTo(returnTo)));
  return {
    state,
    cookie: `${STATE_COOKIE}=${state}.${back}; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
  };
}

/** The return path if the callback's state matches this browser's cookie, else null. */
function checkState(cookieHeader: string, state: string | undefined): string | null {
  const raw = parseCookie(cookieHeader, STATE_COOKIE);
  if (!raw || !state) return null;
  const [nonce, back] = raw.split(".");
  if (!nonce || nonce !== state) return null;
  try {
    const bytes = Uint8Array.from(atob((back ?? "").replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));
    return safeReturnTo(new TextDecoder().decode(bytes));
  } catch (e) {
    console.error("auth_state return path unreadable", e);
    return "/";
  }
}

function badState(): Response {
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Sign-in expired</title></head><body style="background:#0a0e1a;color:#e0e6f0;font-family:sans-serif;padding:32px;text-align:center"><p>That sign-in expired or was started in another browser.</p><p><a style="color:#d4af37" href="/">Back to Heavenward</a></p></body></html>`,
    { status: 400, headers: { "Content-Type": "text/html;charset=utf-8", "Set-Cookie": clearState() } },
  );
}

const clearState = () => `${STATE_COOKIE}=; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

/** Reject auth requests from non-production origins */
auth.use("*", async (c, next) => {
  const host = new URL(c.req.url).hostname;
  if (host !== ALLOWED_ORIGIN && host !== "localhost" && host !== "127.0.0.1") {
    return c.json({ ok: false, error: "Auth disabled on this domain" }, 403);
  }
  await next();
});

// ── Google OAuth ────────────────────────────────────────

auth.get("/google", (c) => {
  const redirect = new URL(c.req.url);
  redirect.pathname = "/auth/google/callback";
  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirect.toString(),
    response_type: "code",
    scope: "openid email profile",
    access_type: "online",
  });
  const st = startState(c.req.query("returnTo"));
  params.set("state", st.state);
  c.header("Set-Cookie", st.cookie);
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

auth.get("/google/callback", async (c) => {
  try {
    const code = c.req.query("code");
    if (!code) return c.json({ ok: false, error: "Missing code" }, 400);
    const returnTo = checkState(c.req.header("Cookie") ?? "", c.req.query("state"));
    if (!returnTo) return badState();

    const redirect = new URL(c.req.url);
    redirect.search = "";
    redirect.hash = "";

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: c.env.GOOGLE_CLIENT_ID,
        client_secret: c.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirect.toString(),
        grant_type: "authorization_code",
      }),
    });

    const tokens: unknown = await tokenRes.json();
    if (
      typeof tokens !== "object" ||
      tokens === null ||
      !("access_token" in tokens)
    ) {
      return c.json(
        { ok: false, error: "Token exchange failed", details: tokens },
        400,
      );
    }

    const userRes = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      {
        headers: {
          Authorization: `Bearer ${(tokens as Record<string, string>).access_token}`,
        },
      },
    );
    const profile: unknown = await userRes.json();
    if (typeof profile !== "object" || profile === null) {
      return c.json(
        { ok: false, error: "Profile fetch failed", details: profile },
        400,
      );
    }

    const p = profile as Record<string, string>;
    const userId = `google-${p.id}`;

    await c.env.DB.prepare(
      "INSERT INTO users (id, email, name, provider) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET email=?, name=?",
    )
      .bind(userId, p.email, p.name, "google", p.email, p.name)
      .run();

    const blocked = await checkUserStatus(c.env.DB, userId);
    if (blocked) return blockedPage(blocked);

    await recordLogin(
      c.env.DB,
      userId,
      extractGeo(c),
      c.req.header("User-Agent")?.slice(0, 512) ?? null,
    );

    const jwt = await signJWT(
      { sub: userId, email: p.email, name: p.name, provider: "google" },
      c.env.JWT_SECRET,
    );

    return loginRedirect(jwt, returnTo);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: "Google auth error", details: msg }, 500);
  }
});

// ── Microsoft OAuth ─────────────────────────────────────

auth.get("/microsoft", (c) => {
  const redirect = new URL(c.req.url);
  redirect.pathname = "/auth/microsoft/callback";
  const params = new URLSearchParams({
    client_id: c.env.MICROSOFT_CLIENT_ID,
    redirect_uri: redirect.toString(),
    response_type: "code",
    scope: "openid email profile",
    response_mode: "query",
  });
  const st = startState(c.req.query("returnTo"));
  params.set("state", st.state);
  c.header("Set-Cookie", st.cookie);
  return c.redirect(
    `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`,
  );
});

auth.get("/microsoft/callback", async (c) => {
  try {
    const code = c.req.query("code");
    if (!code) return c.json({ ok: false, error: "Missing code" }, 400);
    const returnTo = checkState(c.req.header("Cookie") ?? "", c.req.query("state"));
    if (!returnTo) return badState();

    const redirect = new URL(c.req.url);
    redirect.search = "";
    redirect.hash = "";

    const tokenRes = await fetch(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: c.env.MICROSOFT_CLIENT_ID,
          client_secret: c.env.MICROSOFT_CLIENT_SECRET,
          redirect_uri: redirect.toString(),
          grant_type: "authorization_code",
          scope: "openid email profile",
        }),
      },
    );

    const tokens: unknown = await tokenRes.json();
    if (
      typeof tokens !== "object" ||
      tokens === null ||
      !("id_token" in tokens)
    ) {
      return c.json(
        { ok: false, error: "Token exchange failed", details: tokens },
        400,
      );
    }

    // Decode the ID token payload (already verified by Entra via HTTPS)
    const idToken = (tokens as Record<string, string>).id_token;
    const payloadB64 = idToken.split(".")[1];
    const payload: unknown = JSON.parse(
      atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")),
    );
    if (typeof payload !== "object" || payload === null) {
      return c.json({ ok: false, error: "Invalid ID token" }, 400);
    }

    const claims = payload as Record<string, string>;
    const msId = claims.oid || claims.sub || "";
    if (!msId) {
      return c.json(
        { ok: false, error: "No user ID in token", details: claims },
        400,
      );
    }
    const userId = `microsoft-${msId}`;
    const email = claims.email || claims.preferred_username || "";
    const name = claims.name || email || "Microsoft User";

    await c.env.DB.prepare(
      "INSERT INTO users (id, email, name, provider) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET email=?, name=?",
    )
      .bind(userId, email, name, "microsoft", email, name)
      .run();

    const blocked = await checkUserStatus(c.env.DB, userId);
    if (blocked) return blockedPage(blocked);

    await recordLogin(
      c.env.DB,
      userId,
      extractGeo(c),
      c.req.header("User-Agent")?.slice(0, 512) ?? null,
    );

    const jwt = await signJWT(
      {
        sub: userId,
        email,
        name,
        provider: "microsoft",
      },
      c.env.JWT_SECRET,
    );

    return loginRedirect(jwt, returnTo);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json(
      { ok: false, error: "Microsoft auth error", details: msg },
      500,
    );
  }
});

// ── Logout ──────────────────────────────────────────────

auth.post("/logout", () => {
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Domain=${ALLOWED_ORIGIN}`,
    },
  });
});

/** Build login redirect with session cookie + localStorage hint script */
function loginRedirect(jwt: string, returnTo = "/"): Response {
  const cookie = `session=${jwt}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400; Domain=${ALLOWED_ORIGIN}`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0e1a;color:#e0e6f0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px}
.card{background:#111827;border:1px solid #1e2a42;border-radius:14px;max-width:480px;width:100%;padding:32px 28px;text-align:center}
h1{font-size:1.3rem;margin-bottom:8px;color:#f5e6a3}
.sub{color:#7b869c;font-size:.88rem;margin-bottom:24px;line-height:1.6}
.note{color:#7b869c;font-size:.78rem;line-height:1.5;margin-bottom:24px;padding:12px 16px;background:rgba(212,175,55,.06);border:1px solid rgba(212,175,55,.12);border-radius:10px;text-align:left}
.note strong{color:#e0e6f0}
.btn{display:block;width:100%;padding:14px;border-radius:10px;border:none;font-size:.95rem;font-weight:600;cursor:pointer;margin-bottom:10px;min-height:44px}
.btn-go{background:#d4af37;color:#0a0e1a}
.btn-go:hover{background:#f5e6a3}
</style></head><body>
<div class="card">
<h1>Welcome to Heavenward ✦</h1>
<p class="sub">Your account has been created.</p>
<div class="note">
<strong>A quick note:</strong> Heavenward is currently free and we intend to keep it that way. If that ever changes, we'll email you in advance. By continuing, you agree that we may contact you with important service updates.
</div>
<button class="btn btn-go" onclick="localStorage.setItem('heavenward-has-session','1');location.replace(${JSON.stringify(returnTo).replace(/</g, "\\u003c").replace(/&/g, "&amp;").replace(/"/g, "&quot;")})">Continue to Heavenward</button>
</div>
</body></html>`;
  const headers = new Headers({ "Content-Type": "text/html;charset=utf-8" });
  headers.append("Set-Cookie", cookie);
  headers.append("Set-Cookie", clearState());
  return new Response(html, { status: 200, headers });
}

export default auth;
