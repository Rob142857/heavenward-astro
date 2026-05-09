import { Hono } from "hono";
import { signJWT } from "../middleware/auth.js";

interface Env {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  MICROSOFT_CLIENT_ID: string;
  MICROSOFT_CLIENT_SECRET: string;
  JWT_SECRET: string;
  DB: D1Database;
}

const auth = new Hono<{ Bindings: Env }>();

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
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

auth.get("/google/callback", async (c) => {
  const code = c.req.query("code");
  if (!code) return c.json({ ok: false, error: "Missing code" }, 400);

  const redirect = new URL(c.req.url);
  redirect.search = "";

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
    return c.json({ ok: false, error: "Token exchange failed" }, 400);
  }

  const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: {
      Authorization: `Bearer ${(tokens as Record<string, string>).access_token}`,
    },
  });
  const profile: unknown = await userRes.json();
  if (typeof profile !== "object" || profile === null) {
    return c.json({ ok: false, error: "Profile fetch failed" }, 400);
  }

  const p = profile as Record<string, string>;
  const userId = `google-${p.id}`;

  await c.env.DB.prepare(
    "INSERT INTO users (id, email, name, provider) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET email=?, name=?",
  )
    .bind(userId, p.email, p.name, "google", p.email, p.name)
    .run();

  const jwt = await signJWT(
    { sub: userId, email: p.email, name: p.name, provider: "google" },
    c.env.JWT_SECRET,
  );

  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": `session=${jwt}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`,
    },
  });
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
  return c.redirect(
    `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`,
  );
});

auth.get("/microsoft/callback", async (c) => {
  const code = c.req.query("code");
  if (!code) return c.json({ ok: false, error: "Missing code" }, 400);

  const redirect = new URL(c.req.url);
  redirect.search = "";

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
    !("access_token" in tokens)
  ) {
    return c.json({ ok: false, error: "Token exchange failed" }, 400);
  }

  const userRes = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: {
      Authorization: `Bearer ${(tokens as Record<string, string>).access_token}`,
    },
  });
  const profile: unknown = await userRes.json();
  if (typeof profile !== "object" || profile === null) {
    return c.json({ ok: false, error: "Profile fetch failed" }, 400);
  }

  const p = profile as Record<string, string>;
  const userId = `microsoft-${p.id}`;

  await c.env.DB.prepare(
    "INSERT INTO users (id, email, name, provider) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET email=?, name=?",
  )
    .bind(
      userId,
      p.mail || p.userPrincipalName,
      p.displayName,
      "microsoft",
      p.mail || p.userPrincipalName,
      p.displayName,
    )
    .run();

  const jwt = await signJWT(
    {
      sub: userId,
      email: p.mail || p.userPrincipalName,
      name: p.displayName,
      provider: "microsoft",
    },
    c.env.JWT_SECRET,
  );

  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": `session=${jwt}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`,
    },
  });
});

// ── Logout ──────────────────────────────────────────────

auth.post("/logout", (c) => {
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie":
        "session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0",
    },
  });
});

export default auth;
