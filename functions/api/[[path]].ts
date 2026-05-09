import { Hono } from 'hono';
import { handle } from 'hono/cloudflare-pages';
import api from '../api/handler.js';

interface Env {
  DB: D1Database;
  USER_PREFS: KVNamespace;
  JWT_SECRET: string;
}

const app = new Hono<{ Bindings: Env }>();
app.route('/', api);

export const onRequest = handle(app);
