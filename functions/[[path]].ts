import { Hono } from "hono";
import { handle } from "hono/cloudflare-pages";
import auth from "./auth/handler.js";
import api from "./api/handler.js";
import admin from "./admin/handler.js";

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

// ── Public event ingestion (no auth) ────────────────────
app.post("/api/event", async (c) => {
  const body: unknown = await c.req.json();
  if (typeof body !== "object" || body === null) {
    return c.json({ ok: false }, 400);
  }
  const b = body as Record<string, unknown>;
  const sid = typeof b.sid === "string" ? b.sid : "unknown";
  const event = typeof b.event === "string" ? b.event : "unknown";
  const path = typeof b.path === "string" ? b.path : "/";
  const detail = typeof b.detail === "string" ? b.detail : null;
  const ua = c.req.header("User-Agent") ?? null;

  await c.env.DB.prepare(
    "INSERT INTO events (session_id, user_id, event, path, detail, ua) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(sid, null, event, path, detail, ua)
    .run();

  return c.json({ ok: true });
});

app.route("/auth", auth);
app.route("/api", api);
app.route("/admin", admin);

export const onRequest = handle(app);
