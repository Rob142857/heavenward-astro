import { Hono } from "hono";
import { handle } from "hono/cloudflare-pages";
import auth from "./auth/handler.js";
import api from "./api/handler.js";
import admin from "./admin/handler.js";
import { verifyJWT, parseCookie } from "./middleware/auth.js";

interface Env {
  DB: D1Database;
  USER_PREFS: KVNamespace;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  MICROSOFT_CLIENT_ID: string;
  MICROSOFT_CLIENT_SECRET: string;
  JWT_SECRET: string;
}

const app = new Hono<{ Bindings: Env }>();

// One-shot migration: add audit + user-management columns to legacy tables.
// SQLite has no ADD COLUMN IF NOT EXISTS — swallow "duplicate column" errors.
let migrated = false;
async function ensureSchema(db: D1Database): Promise<void> {
  if (migrated) return;
  const eventCols = [
    "ip TEXT",
    "country TEXT",
    "region TEXT",
    "city TEXT",
    "tz TEXT",
    "referrer TEXT",
    "dwell_ms INTEGER",
  ];
  for (const col of eventCols) {
    try {
      await db.prepare(`ALTER TABLE events ADD COLUMN ${col}`).run();
    } catch {
      /* exists */
    }
  }
  const userCols = [
    "status TEXT NOT NULL DEFAULT 'active'",
    "status_reason TEXT",
    "status_changed_at TEXT",
    "status_changed_by TEXT",
    "last_login_at TEXT",
    "last_login_ip TEXT",
    "last_login_country TEXT",
    "last_login_city TEXT",
    "login_count INTEGER NOT NULL DEFAULT 0",
  ];
  for (const col of userCols) {
    try {
      await db.prepare(`ALTER TABLE users ADD COLUMN ${col}`).run();
    } catch {
      /* exists */
    }
  }
  const idx = [
    "CREATE INDEX IF NOT EXISTS idx_events_session_ts ON events(session_id, ts)",
    "CREATE INDEX IF NOT EXISTS idx_events_user_ts ON events(user_id, ts)",
    "CREATE INDEX IF NOT EXISTS idx_users_status ON users(status)",
    "CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)",
    "CREATE INDEX IF NOT EXISTS idx_users_last_login ON users(last_login_at)",
    `CREATE TABLE IF NOT EXISTS admin_actions (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       actor_id TEXT,
       actor_email TEXT,
       action TEXT NOT NULL,
       target_user TEXT,
       detail TEXT,
       ip TEXT,
       ts TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
    "CREATE INDEX IF NOT EXISTS idx_admin_actions_ts ON admin_actions(ts)",
    "CREATE INDEX IF NOT EXISTS idx_admin_actions_target ON admin_actions(target_user)",
  ];
  for (const sql of idx) {
    try {
      await db.prepare(sql).run();
    } catch {
      /* ignore */
    }
  }
  migrated = true;
}

// ── Public event ingestion (no auth required, but JWT cookie stamps user_id) ──
app.post("/api/event", async (c) => {
  await ensureSchema(c.env.DB);

  const body: unknown = await c.req.json().catch(() => null);
  if (typeof body !== "object" || body === null) {
    return c.json({ ok: false }, 400);
  }
  const b = body as Record<string, unknown>;
  const sid = typeof b.sid === "string" ? b.sid : "unknown";
  const event = typeof b.event === "string" ? b.event : "unknown";
  const path = typeof b.path === "string" ? b.path : "/";
  const detail = typeof b.detail === "string" ? b.detail : null;
  const referrer =
    typeof b.referrer === "string" ? b.referrer.slice(0, 256) : null;
  const dwellMs =
    typeof b.dwell_ms === "number" &&
    Number.isFinite(b.dwell_ms) &&
    b.dwell_ms >= 0
      ? Math.min(Math.floor(b.dwell_ms), 24 * 3600 * 1000)
      : null;
  const tz = typeof b.tz === "string" ? b.tz.slice(0, 64) : null;

  const ua = c.req.header("User-Agent")?.slice(0, 512) ?? null;
  const ip =
    c.req.header("CF-Connecting-IP") ??
    c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ??
    null;

  const cf = (c.req.raw as Request & { cf?: Record<string, unknown> }).cf ?? {};
  const country = typeof cf.country === "string" ? cf.country : null;
  const region = typeof cf.region === "string" ? cf.region : null;
  const city = typeof cf.city === "string" ? cf.city : null;
  const cfTz = typeof cf.timezone === "string" ? cf.timezone : null;

  // Best-effort: extract user_id from session JWT cookie so we can correlate
  // sessions → users in the canonical audit log. Failures fall back to null.
  let userId: string | null = null;
  const token = parseCookie(c.req.header("Cookie") ?? "", "session");
  if (token) {
    const payload = await verifyJWT(token, c.env.JWT_SECRET).catch(() => null);
    if (payload) userId = payload.sub;
  }

  await c.env.DB.prepare(
    `INSERT INTO events (session_id, user_id, event, path, detail, ua, ip, country, region, city, tz, referrer, dwell_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      sid,
      userId,
      event,
      path,
      detail,
      ua,
      ip,
      country,
      region,
      city,
      tz ?? cfTz,
      referrer,
      dwellMs,
    )
    .run();

  return c.json({ ok: true });
});

app.route("/auth", auth);
app.route("/api", api);
app.route("/admin", admin);

export const onRequest = handle(app);
