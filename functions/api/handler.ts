import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";

interface Env {
  DB: D1Database;
  USER_PREFS: KVNamespace;
  JWT_SECRET: string;
}

interface JWTUser {
  sub: string;
  email: string;
  name: string;
  provider: "google" | "microsoft";
}

type Variables = { user: JWTUser };

const api = new Hono<{ Bindings: Env; Variables: Variables }>();

api.use("*", authMiddleware);

// ── User profile ────────────────────────────────────────

api.get("/user", (c) => {
  const user = c.get("user");
  return c.json({
    ok: true,
    data: {
      id: user.sub,
      email: user.email,
      name: user.name,
      provider: user.provider,
    },
  });
});

// ── Preferences ─────────────────────────────────────────

api.get("/prefs", async (c) => {
  const user = c.get("user");
  const raw = await c.env.USER_PREFS.get(user.sub);
  if (!raw) {
    return c.json({ ok: true, data: null });
  }
  return c.json({ ok: true, data: JSON.parse(raw) });
});

api.put("/prefs", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();
  await c.env.USER_PREFS.put(user.sub, JSON.stringify(body));
  return c.json({ ok: true });
});

// ── API Keys ────────────────────────────────────────────

api.post("/keys", async (c) => {
  const user = c.get("user");
  const body: unknown = await c.req.json();
  if (typeof body !== "object" || body === null || !("name" in body)) {
    return c.json({ ok: false, error: "Missing name" }, 400);
  }

  const id = crypto.randomUUID();
  const key = `hv_${generateKey(32)}`;
  const prefix = key.slice(0, 7);

  const keyHash = await hashKey(key);

  await c.env.DB.prepare(
    "INSERT INTO api_keys (id, user_id, name, prefix, key_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(
      id,
      user.sub,
      (body as Record<string, string>).name,
      prefix,
      keyHash,
      new Date().toISOString(),
    )
    .run();

  return c.json(
    {
      ok: true,
      data: {
        id,
        name: (body as Record<string, string>).name,
        prefix,
        key,
        createdAt: new Date().toISOString(),
      },
    },
    201,
  );
});

api.delete("/keys/:id", async (c) => {
  const user = c.get("user");
  const keyId = c.req.param("id");

  await c.env.DB.prepare("DELETE FROM api_keys WHERE id = ? AND user_id = ?")
    .bind(keyId, user.sub)
    .run();

  return c.json({ ok: true });
});

api.get("/keys", async (c) => {
  const user = c.get("user");
  const result = await c.env.DB.prepare(
    "SELECT id, name, prefix, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC",
  )
    .bind(user.sub)
    .all();

  return c.json({ ok: true, data: result.results });
});

// ── Helpers ─────────────────────────────────────────────

function generateKey(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, length);
}

async function hashKey(key: string): Promise<string> {
  const encoded = new TextEncoder().encode(key);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

export default api;
