import { Hono } from "hono";
import { handle } from "hono/cloudflare-pages";
import auth from "./auth/handler.js";
import api from "./api/handler.js";

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

app.route("/auth", auth);
app.route("/api", api);

export const onRequest = handle(app);
