// Read-only MCP server at /mcp, plus the OAuth 2.1 endpoints Claude's custom
// connectors use. Sign-in is the app's own Google / Microsoft SSO; a grant is
// only possible once the account has turned MCP on in Settings. Every call
// and grant is audited to the `events` table (shown in /admin).
import { Hono, type Context } from "hono";
import { handleWeather, type CacheLike } from "../weather/core.ts";
import { parseForecast, type CloudForecast } from "../../src/engine/cloud.ts";
import { parseCookie, verifyJWT } from "../middleware/auth.ts";
import {
  ACCESS_TTL,
  CODE_TTL,
  CONSENT_TTL,
  REFRESH_TTL,
  grantLive,
  pkceMatches,
  randomId,
  readSwitch,
  sign,
  validRedirectUri,
  verify,
  type ClientClaims,
  type CodeClaims,
  type GrantClaims,
} from "./oauth.ts";
import { Catalog, TOOLS, ToolError, type CatalogRow, type ToolDeps } from "./tools.ts";

interface Env {
  DB: D1Database;
  USER_PREFS: KVNamespace;
  JWT_SECRET: string;
  ASSETS: Fetcher;
}

type C = Context<{ Bindings: Env }>;

export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
const SERVER_INFO = { name: "heavenward", title: "Heavenward sky", version: "1.0.0" };

const mcp = new Hono<{ Bindings: Env }>();

const origin = (c: C) => new URL(c.req.url).origin;

function redirect302(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store" } });
}

function noStore(res: Response): Response {
  res.headers.set("Cache-Control", "no-store");
  return res;
}

// ── Audit ────────────────────────────────────────────────

async function audit(c: C, userId: string, event: string, detail: object, latLon?: { lat?: unknown; lon?: unknown }) {
  const cf = (c.req.raw as Request & { cf?: Record<string, unknown> }).cf ?? {};
  // Coarse place only (1 dp, about 10 km), never the raw position.
  const coarse = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10) / 10 : undefined);
  const d = { ...detail, lat: coarse(latLon?.lat), lon: coarse(latLon?.lon) };
  try {
    await c.env.DB.prepare(
      `INSERT INTO events (session_id, user_id, event, path, detail, ua, ip, country, city)
       VALUES (?, ?, ?, '/mcp', ?, ?, ?, ?, ?)`,
    )
      .bind(
        `mcp-${userId}`,
        userId,
        event,
        JSON.stringify(d).slice(0, 1000),
        c.req.header("User-Agent")?.slice(0, 512) ?? null,
        c.req.header("CF-Connecting-IP") ?? null,
        typeof cf.country === "string" ? cf.country : null,
        typeof cf.city === "string" ? cf.city : null,
      )
      .run();
  } catch (e) {
    // Auditing must never break a call, but a lost audit row is worth a log line.
    console.error("mcp audit insert failed", e);
  }
}

async function userStatus(db: D1Database, userId: string): Promise<string | null> {
  const row = await db.prepare("SELECT status FROM users WHERE id = ?").bind(userId).first<{ status: string | null }>();
  if (!row) return "missing";
  const s = row.status ?? "active";
  return s === "blocked" || s === "banned" ? s : null;
}

// ── Discovery ────────────────────────────────────────────

export function protectedResource(base: string) {
  return {
    resource: `${base}/mcp`,
    authorization_servers: [base],
    bearer_methods_supported: ["header"],
    resource_name: "Heavenward sky (read-only)",
  };
}

export function authServer(base: string) {
  return {
    issuer: base,
    authorization_endpoint: `${base}/mcp/authorize`,
    token_endpoint: `${base}/mcp/token`,
    registration_endpoint: `${base}/mcp/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["sky.read"],
  };
}

// Mounted at the app root by functions/[[path]].ts.
export const wellKnown = new Hono<{ Bindings: Env }>();
wellKnown.get("/oauth-protected-resource", (c) => noStore(c.json(protectedResource(origin(c)))));
wellKnown.get("/oauth-protected-resource/mcp", (c) => noStore(c.json(protectedResource(origin(c)))));
wellKnown.get("/oauth-authorization-server", (c) => noStore(c.json(authServer(origin(c)))));
wellKnown.get("/oauth-authorization-server/mcp", (c) => noStore(c.json(authServer(origin(c)))));

// ── Dynamic client registration (RFC 7591) ───────────────

mcp.post("/register", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const uris = body?.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10 || !uris.every(validRedirectUri)) {
    return noStore(c.json({ error: "invalid_redirect_uri", error_description: "redirect_uris must be https (or http on localhost)" }, 400));
  }
  const name = typeof body?.client_name === "string" ? body.client_name.slice(0, 80) : "MCP client";
  const claims: ClientClaims = { r: uris as string[], n: name };
  const clientId = await sign("client", claims, c.env.JWT_SECRET, 0);
  return noStore(
    c.json(
      {
        client_id: clientId,
        client_name: name,
        redirect_uris: uris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        client_id_issued_at: Math.floor(Date.now() / 1000),
      },
      201,
    ),
  );
});

// ── Authorize ────────────────────────────────────────────

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

function page(title: string, inner: string, status = 200): Response {
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#0a0e1a;color:#e0e6f0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px}
.card{background:#111827;border:1px solid #1e2a42;border-radius:14px;max-width:440px;width:100%;padding:28px;text-align:center}
h1{font-size:1.25rem;color:#f5e6a3;margin-bottom:10px}p{color:#9aa5bb;font-size:.9rem;line-height:1.5;margin-bottom:18px}
.btn{display:block;width:100%;padding:14px;border-radius:10px;border:1px solid #2a3654;font-size:.95rem;font-weight:600;margin-bottom:10px;min-height:44px;text-decoration:none;color:#e0e6f0;background:#16203a;cursor:pointer}
.go{background:#d4af37;color:#0a0e1a;border:none}ul{text-align:left;color:#9aa5bb;font-size:.85rem;margin:0 0 18px 18px;line-height:1.6}</style></head>
<body><div class="card">${inner}</div></body></html>`;
  return noStore(
    new Response(html, {
      status,
      headers: { "Content-Type": "text/html;charset=utf-8", "X-Frame-Options": "DENY", "Content-Security-Policy": "frame-ancestors 'none'" },
    }),
  );
}

interface AuthRequest {
  clientId: string;
  client: ClientClaims;
  redirectUri: string;
  challenge: string;
  state: string | null;
}

/** Check the request's client and redirect URI. Errors here must not redirect. */
async function readAuthRequest(c: C, q: Record<string, string | undefined>): Promise<AuthRequest | Response> {
  const client = await verify<ClientClaims>("client", q.client_id, c.env.JWT_SECRET);
  if (!client) return page("Unknown app", "<h1>Unknown app</h1><p>This app is not registered with Heavenward. Remove the connector and add it again.</p>", 400);
  const redirectUri = q.redirect_uri ?? "";
  if (!client.r.includes(redirectUri)) return page("Bad request", "<h1>Bad request</h1><p>The app's redirect address does not match its registration.</p>", 400);
  if (q.response_type !== "code" || q.code_challenge_method !== "S256" || !q.code_challenge || !/^[A-Za-z0-9_-]{43}$/.test(q.code_challenge)) {
    return redirectError(redirectUri, "invalid_request", q.state ?? null, "PKCE S256 and response_type=code are required");
  }
  return { clientId: q.client_id!, client, redirectUri, challenge: q.code_challenge, state: q.state ?? null };
}

function redirectError(uri: string, error: string, state: string | null, description?: string): Response {
  const u = new URL(uri);
  u.searchParams.set("error", error);
  if (description) u.searchParams.set("error_description", description);
  if (state) u.searchParams.set("state", state);
  return redirect302(u.toString());
}

async function sessionUser(c: C) {
  const token = parseCookie(c.req.header("Cookie") ?? "", "session");
  return token ? verifyJWT(token, c.env.JWT_SECRET).catch(() => null) : null;
}

mcp.get("/authorize", async (c) => {
  const q = c.req.query();
  const req = await readAuthRequest(c, q);
  if (req instanceof Response) return req;

  const user = await sessionUser(c);
  if (!user) {
    const back = encodeURIComponent(new URL(c.req.url).pathname + new URL(c.req.url).search);
    return page(
      "Sign in to Heavenward",
      `<h1>Sign in to Heavenward</h1><p><strong>${esc(req.client.n)}</strong> wants to read sky data for you. Sign in first.</p>
<a class="btn" href="/auth/google?returnTo=${back}">Sign in with Google</a>
<a class="btn" href="/auth/microsoft?returnTo=${back}">Sign in with Microsoft</a>`,
    );
  }
  const blocked = await userStatus(c.env.DB, user.sub);
  if (blocked) return page("Access blocked", `<h1>Account ${esc(blocked)}</h1><p>This Heavenward account cannot use MCP.</p>`, 403);

  const sw = await readSwitch(c.env.USER_PREFS, user.sub);
  if (!sw.on) {
    return page(
      "Turn on MCP first",
      `<h1>Turn on MCP first</h1><p>Open Heavenward, go to <strong>Settings</strong>, switch on <strong>MCP</strong>, then try connecting again.</p><a class="btn go" href="/#/sources">Open Settings</a>`,
    );
  }

  // The consent form carries a short signed copy of the request, tied to this user.
  const consent = await sign(
    "consent",
    { sub: user.sub, cid: req.clientId, ru: req.redirectUri, cc: req.challenge, st: req.state, gen: sw.gen },
    c.env.JWT_SECRET,
    CONSENT_TTL,
  );
  return page(
    "Allow access",
    `<h1>Allow ${esc(req.client.n)}?</h1><p>Signed in as ${esc(user.email)}.</p>
<p>It will send you back to <strong>${esc(new URL(req.redirectUri).host)}</strong>.</p>
<ul><li>Read-only: target altitudes, night and Moon times, cloud forecast, Seestar framing.</li><li>Nothing in your account is read or changed.</li><li>Every call is logged. Turn MCP off in Settings to cut access.</li></ul>
<form method="post" action="/mcp/authorize"><input type="hidden" name="consent" value="${esc(consent)}">
<button class="btn go" type="submit" name="decision" value="allow">Allow</button>
<button class="btn" type="submit" name="decision" value="deny">Deny</button></form>`,
  );
});

interface ConsentClaims {
  sub: string;
  cid: string;
  ru: string;
  cc: string;
  st: string | null;
  gen: number;
}

mcp.post("/authorize", async (c) => {
  const form = await c.req.parseBody();
  const consent = await verify<ConsentClaims>("consent", String(form.consent ?? ""), c.env.JWT_SECRET);
  const user = await sessionUser(c);
  // The session cookie is SameSite=Lax, so it is absent on a cross-site POST.
  if (!consent || !user || user.sub !== consent.sub) {
    return page("Expired", "<h1>That request expired</h1><p>Go back to the app and connect again.</p>", 400);
  }
  if (form.decision !== "allow") return redirectError(consent.ru, "access_denied", consent.st);

  const blocked = await userStatus(c.env.DB, user.sub);
  const sw = await readSwitch(c.env.USER_PREFS, user.sub);
  if (blocked || !grantLive(sw, consent)) return redirectError(consent.ru, "access_denied", consent.st, "MCP is off for this account");

  const code: CodeClaims = { sub: user.sub, cid: consent.cid, gen: sw.gen, ru: consent.ru, cc: consent.cc, jti: randomId(12) };
  const u = new URL(consent.ru);
  u.searchParams.set("code", await sign("code", code, c.env.JWT_SECRET, CODE_TTL));
  if (consent.st) u.searchParams.set("state", consent.st);
  u.searchParams.set("iss", origin(c));
  await audit(c, user.sub, "mcp_grant", { step: "approved", client: (await verify<ClientClaims>("client", consent.cid, c.env.JWT_SECRET))?.n });
  return redirect302(u.toString());
});

// ── Token ────────────────────────────────────────────────

function tokenError(c: C, error: string, description: string, status = 400) {
  return noStore(c.json({ error, error_description: description }, status as 400));
}

async function issueTokens(c: C, g: GrantClaims) {
  const grant = { sub: g.sub, cid: g.cid, gen: g.gen };
  return noStore(
    c.json({
      access_token: await sign("access", grant, c.env.JWT_SECRET, ACCESS_TTL),
      token_type: "Bearer",
      expires_in: ACCESS_TTL,
      refresh_token: await sign("refresh", { ...grant, jti: randomId(12) }, c.env.JWT_SECRET, REFRESH_TTL),
      scope: "sky.read",
    }),
  );
}

mcp.post("/token", async (c) => {
  const form = await c.req.parseBody();
  const s = (k: string) => (typeof form[k] === "string" ? (form[k] as string) : "");

  if (s("grant_type") === "authorization_code") {
    const code = await verify<CodeClaims>("code", s("code"), c.env.JWT_SECRET);
    if (!code || code.cid !== s("client_id") || code.ru !== s("redirect_uri")) return tokenError(c, "invalid_grant", "code is invalid or expired");
    if (!(await pkceMatches(s("code_verifier"), code.cc))) return tokenError(c, "invalid_grant", "PKCE check failed");
    // One-time use. KV is eventually consistent, so this is best-effort on top
    // of the 5-minute expiry and PKCE (a stolen code is useless without the verifier).
    const usedKey = `mcp:used:${code.jti}`;
    if (await c.env.USER_PREFS.get(usedKey)) return tokenError(c, "invalid_grant", "code already used");
    await c.env.USER_PREFS.put(usedKey, "1", { expirationTtl: 600 });
    if (await userStatus(c.env.DB, code.sub)) return tokenError(c, "invalid_grant", "account cannot use MCP");
    if (!grantLive(await readSwitch(c.env.USER_PREFS, code.sub), code)) return tokenError(c, "invalid_grant", "access was turned off");
    await audit(c, code.sub, "mcp_grant", { step: "token" });
    return issueTokens(c, code);
  }

  if (s("grant_type") === "refresh_token") {
    const g = await verify<GrantClaims & { jti: string }>("refresh", s("refresh_token"), c.env.JWT_SECRET);
    if (!g || (s("client_id") && g.cid !== s("client_id"))) return tokenError(c, "invalid_grant", "refresh token is invalid or expired");
    const sw = await readSwitch(c.env.USER_PREFS, g.sub);
    if (!grantLive(sw, g) || (await userStatus(c.env.DB, g.sub))) return tokenError(c, "invalid_grant", "access was turned off");
    // Rotation: each refresh token works once (OAuth 2.1 public clients). Best-effort, like codes.
    const usedKey = `mcp:used:${g.jti}`;
    if (await c.env.USER_PREFS.get(usedKey)) return tokenError(c, "invalid_grant", "refresh token already used");
    await c.env.USER_PREFS.put(usedKey, "1", { expirationTtl: REFRESH_TTL });
    await audit(c, g.sub, "mcp_grant", { step: "refresh" });
    return issueTokens(c, g);
  }

  return tokenError(c, "unsupported_grant_type", "use authorization_code or refresh_token");
});

// ── MCP endpoint (Streamable HTTP, stateless, JSON responses) ─

let catalogPromise: Promise<Catalog> | null = null;

function loadCatalog(c: C): Promise<Catalog> {
  catalogPromise ??= c.env.ASSETS.fetch(new URL("/mcp-catalog.json", c.req.url).toString())
    .then((r) => {
      if (!r.ok) throw new Error(`catalog ${r.status}`);
      return r.json() as Promise<CatalogRow[]>;
    })
    .then((rows) => new Catalog(rows))
    .catch((e) => {
      catalogPromise = null;
      throw e;
    });
  return catalogPromise;
}

function deps(c: C): ToolDeps {
  return {
    catalog: () => loadCatalog(c),
    now: () => Date.now(),
    async forecast(lat, lon): Promise<CloudForecast | null> {
      const url = new URL("/api/weather", c.req.url);
      url.search = `lat=${lat}&lon=${lon}`;
      const res = await handleWeather(new Request(url), {
        cache: typeof caches !== "undefined" ? (caches as unknown as { default: CacheLike }).default : null,
        fetch: (u) => fetch(u, { headers: { Accept: "application/json" } }),
        now: () => Date.now(),
        waitUntil: (p) => c.executionCtx.waitUntil(p),
      });
      return res.ok ? parseForecast(await res.json()) : null;
    },
  };
}

function unauthorized(c: C, error?: string) {
  const meta = `${origin(c)}/.well-known/oauth-protected-resource`;
  const res = c.json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null }, 401);
  res.headers.set("WWW-Authenticate", `Bearer resource_metadata="${meta}"${error ? `, error="${error}"` : ""}`);
  return noStore(res);
}

type RpcId = string | number | null;
const rpcResult = (id: RpcId, result: unknown) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id: RpcId, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

mcp.get("/", (c) => noStore(c.text("Use POST (MCP Streamable HTTP)", 405, { Allow: "POST" })));
mcp.delete("/", (c) => noStore(c.body(null, 405, { Allow: "POST" })));

// Also mounted at "/mcp/" by functions/[[path]].ts: Hono treats the slash as a different path.
export const handleRpc = async (c: C) => {
  const auth = c.req.header("Authorization") ?? "";
  const grant = auth.startsWith("Bearer ") ? await verify<GrantClaims>("access", auth.slice(7).trim(), c.env.JWT_SECRET) : null;
  if (!grant) return unauthorized(c, auth ? "invalid_token" : undefined);
  const [sw, blocked] = await Promise.all([readSwitch(c.env.USER_PREFS, grant.sub), userStatus(c.env.DB, grant.sub)]);
  if (!grantLive(sw, grant) || blocked) return unauthorized(c, "invalid_token");

  const msg = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (msg && typeof msg === "object" && !Array.isArray(msg) && msg.jsonrpc === "2.0" && !("method" in msg) && ("result" in msg || "error" in msg)) {
    return noStore(c.body(null, 202)); // a response from the client: nothing to do
  }
  if (!msg || typeof msg !== "object" || Array.isArray(msg) || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return noStore(c.json(rpcError(null, -32600, "Invalid request"), 400));
  }
  const id = (typeof msg.id === "string" || typeof msg.id === "number" ? msg.id : null) as RpcId;
  if (!("id" in msg)) return noStore(c.body(null, 202)); // notification
  const params = (typeof msg.params === "object" && msg.params !== null ? msg.params : {}) as Record<string, unknown>;

  switch (msg.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return noStore(
        c.json(
          rpcResult(id, {
            protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER_INFO,
            instructions:
              "Read-only sky planning from Heavenward: target altitudes through the night, darkness and Moon times, cloud forecast, and Seestar S30 Pro framing. Give lat/lon of the observing site. Times are UTC unless you pass tz.",
          }),
        ),
      );
    }
    case "ping":
      return noStore(c.json(rpcResult(id, {})));
    case "tools/list":
      return noStore(
        c.json(
          rpcResult(id, {
            tools: TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: { readOnlyHint: true, openWorldHint: false } })),
          }),
        ),
      );
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return noStore(c.json(rpcError(id, -32602, `Unknown tool: ${String(params.name)}`)));
      const args = (typeof params.arguments === "object" && params.arguments !== null ? params.arguments : {}) as Record<string, unknown>;
      let ok = true;
      let out: unknown;
      try {
        out = await tool.run(args, deps(c));
      } catch (e) {
        if (!(e instanceof ToolError)) console.error(`mcp tool ${tool.name} failed`, e);
        ok = false;
        out = e instanceof ToolError ? e.message : "Something went wrong working that out. Try again.";
      }
      c.executionCtx.waitUntil(audit(c, grant.sub, "mcp_call", { tool: tool.name, targets: tool.count(args), ok }, args));
      return noStore(
        c.json(
          rpcResult(
            id,
            ok
              ? { content: [{ type: "text", text: JSON.stringify(out) }], structuredContent: out, isError: false }
              : { content: [{ type: "text", text: String(out) }], isError: true },
          ),
        ),
      );
    }
    default:
      return noStore(c.json(rpcError(id, -32601, `Method not found: ${msg.method}`)));
  }
};

mcp.post("/", handleRpc);

export default mcp;
