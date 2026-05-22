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

// ── Observations (saved evening sessions) ──────────────────────

interface ObservationEntryPayload {
  id: string;
  name: string;
  type: string;
  brief?: string;
  firstViewedAt: string;
  lastViewedAt: string;
  views: number;
}

interface ObservationPayload {
  id?: string;
  startedAt: string;
  endedAt: string;
  region?: string | null;
  latCoarse?: number | null;
  lonCoarse?: number | null;
  entries: ObservationEntryPayload[];
}

function sanitizeEntries(raw: unknown): ObservationEntryPayload[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ObservationEntryPayload[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const e = item as Record<string, unknown>;
    if (typeof e.id !== "string" || typeof e.name !== "string") continue;
    out.push({
      id: e.id.slice(0, 128),
      name: e.name.slice(0, 200),
      type: typeof e.type === "string" ? e.type.slice(0, 32) : "unknown",
      brief: typeof e.brief === "string" ? e.brief.slice(0, 400) : undefined,
      firstViewedAt: typeof e.firstViewedAt === "string" ? e.firstViewedAt : "",
      lastViewedAt: typeof e.lastViewedAt === "string" ? e.lastViewedAt : "",
      views: typeof e.views === "number" ? Math.min(e.views, 1000) : 1,
    });
    if (out.length >= 500) break; // hard cap per session
  }
  return out;
}

api.post("/observations", async (c) => {
  const user = c.get("user");
  const body = (await c.req.json()) as unknown;
  if (typeof body !== "object" || body === null) {
    return c.json({ ok: false, error: "Invalid body" }, 400);
  }
  const b = body as Record<string, unknown>;
  const entries = sanitizeEntries(b.entries);
  if (!entries) {
    return c.json({ ok: false, error: "Missing entries" }, 400);
  }
  const startedAt = typeof b.startedAt === "string" ? b.startedAt : null;
  const endedAt = typeof b.endedAt === "string" ? b.endedAt : null;
  if (!startedAt || !endedAt) {
    return c.json({ ok: false, error: "Missing timestamps" }, 400);
  }

  const id =
    typeof b.id === "string" && b.id.length <= 64 ? b.id : crypto.randomUUID();
  const region = typeof b.region === "string" ? b.region.slice(0, 120) : null;
  const latCoarse =
    typeof b.latCoarse === "number" ? Math.round(b.latCoarse * 10) / 10 : null;
  const lonCoarse =
    typeof b.lonCoarse === "number" ? Math.round(b.lonCoarse * 10) / 10 : null;

  await c.env.DB.prepare(
    `INSERT INTO observations
       (id, user_id, started_at, ended_at, region, lat_coarse, lon_coarse,
        entry_count, entries_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       ended_at = excluded.ended_at,
       region = excluded.region,
       lat_coarse = excluded.lat_coarse,
       lon_coarse = excluded.lon_coarse,
       entry_count = excluded.entry_count,
       entries_json = excluded.entries_json`,
  )
    .bind(
      id,
      user.sub,
      startedAt,
      endedAt,
      region,
      latCoarse,
      lonCoarse,
      entries.length,
      JSON.stringify(entries),
    )
    .run();

  return c.json({ ok: true, data: { id } }, 201);
});

api.get("/observations", async (c) => {
  const user = c.get("user");
  const result = await c.env.DB.prepare(
    `SELECT id, started_at, ended_at, region, entry_count, entries_json
       FROM observations
      WHERE user_id = ?
      ORDER BY started_at DESC
      LIMIT 100`,
  )
    .bind(user.sub)
    .all();

  const data = (result.results ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    let entries: ObservationEntryPayload[] = [];
    try {
      entries = JSON.parse(String(r.entries_json ?? "[]"));
    } catch {
      entries = [];
    }
    return {
      id: String(r.id),
      startedAt: String(r.started_at),
      endedAt: String(r.ended_at),
      region: r.region === null ? null : String(r.region),
      entryCount: Number(r.entry_count ?? entries.length),
      entries,
    };
  });

  return c.json({ ok: true, data });
});

api.delete("/observations/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  await c.env.DB.prepare(
    "DELETE FROM observations WHERE id = ? AND user_id = ?",
  )
    .bind(id, user.sub)
    .run();
  return c.json({ ok: true });
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
