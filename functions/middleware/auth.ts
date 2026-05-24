import type { MiddlewareHandler } from "hono";

export interface JWTPayload {
  sub: string;
  email: string;
  name: string;
  provider: "google" | "microsoft";
  exp: number;
}

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const cookie = c.req.header("Cookie") ?? "";
  const token = parseCookie(cookie, "session");

  if (!token) {
    return c.json({ ok: false, error: "Unauthorized" }, 401);
  }

  const secret = c.env.JWT_SECRET as string;
  const payload = await verifyJWT(token, secret);
  if (!payload) {
    return c.json({ ok: false, error: "Invalid token" }, 401);
  }

  // Enforce user status (blocked / banned / paused)
  const db = (c.env as { DB?: D1Database }).DB;
  if (db) {
    const row = await db
      .prepare("SELECT status FROM users WHERE id = ?")
      .bind(payload.sub)
      .first<{ status: string | null }>();
    const status = row?.status ?? "active";
    if (status === "blocked" || status === "banned") {
      return c.json({ ok: false, error: "account_" + status }, 403);
    }
    // paused: allow reads, block writes
    if (
      status === "paused" &&
      c.req.method !== "GET" &&
      c.req.method !== "HEAD"
    ) {
      return c.json({ ok: false, error: "account_paused" }, 423);
    }
  }

  c.set("user", payload);
  await next();
};

export async function signJWT(
  payload: Omit<JWTPayload, "exp">,
  secret: string,
  ttlSeconds = 86400,
): Promise<string> {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const body = btoa(JSON.stringify({ ...payload, exp }));
  const data = `${header}.${body}`;

  const key = await importKey(secret);
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data),
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)));

  return `${data}.${sigB64}`;
}

export async function verifyJWT(
  token: string,
  secret: string,
): Promise<JWTPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const key = await importKey(secret);
  const data = `${parts[0]}.${parts[1]}`;
  const sig = Uint8Array.from(atob(parts[2]), (c) => c.charCodeAt(0));

  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    sig,
    new TextEncoder().encode(data),
  );
  if (!valid) return null;

  const payload: unknown = JSON.parse(atob(parts[1]));
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as JWTPayload;

  if (p.exp < Math.floor(Date.now() / 1000)) return null;

  return p;
}

function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export function parseCookie(header: string, name: string): string | null {
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}
