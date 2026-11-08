import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import mcp, { wellKnown } from "../functions/mcp/handler.ts";
import { framing, Catalog, TOOLS, type CatalogRow, type ToolDeps } from "../functions/mcp/tools.ts";
import {
  b64url,
  grantLive,
  pkceMatches,
  readSwitch,
  safeReturnTo,
  sign,
  validRedirectUri,
  verify,
  writeSwitch,
} from "../functions/mcp/oauth.ts";
import { signJWT } from "../functions/middleware/auth.ts";
import { applyCuratedDSO, type CuratedDSO, type DSOEntry } from "../src/catalog/dso.ts";

const SECRET = "test-secret";
const NOW = Date.parse("2026-10-18T09:30:00Z"); // 20:30 AEDT
const SYDNEY = { lat: -33.87, lon: 151.21 };

// ── Fakes ────────────────────────────────────────────────

class FakeKV {
  m = new Map<string, string>();
  async get(k: string) {
    return this.m.get(k) ?? null;
  }
  async put(k: string, v: string) {
    this.m.set(k, v);
  }
}

class FakeDB {
  users = new Map<string, string>([["google-1", "active"]]);
  events: unknown[][] = [];
  prepare(sql: string) {
    const db = this;
    let args: unknown[] = [];
    const stmt = {
      bind(...a: unknown[]) {
        args = a;
        return stmt;
      },
      async first() {
        const s = db.users.get(String(args[0]));
        return s === undefined ? null : { status: s };
      },
      async run() {
        if (sql.includes("INSERT INTO events")) db.events.push(args);
        return {};
      },
    };
    return stmt;
  }
}

const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const dso = applyCuratedDSO(read("../src/catalog/dso.json") as DSOEntry[], read("../src/catalog/dso-curated.json") as CuratedDSO);
const ROWS: CatalogRow[] = [
  ...dso.map((d): CatalogRow => [d.id, d.name, d.commonName || "", d.aliases ?? [], d.type, d.ra, d.dec, d.magnitude, d.size, d.minorAxis, d.positionAngle]),
  ["sirius", "Sirius", "", [], "star", 6.7525, -16.716, -1.44, null, null, null],
];
const catalog = new Catalog(ROWS);

function makeEnv() {
  return {
    DB: new FakeDB(),
    USER_PREFS: new FakeKV(),
    JWT_SECRET: SECRET,
    ASSETS: { fetch: async () => new Response(JSON.stringify(ROWS)) },
  };
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} };

function makeApp() {
  const app = new Hono();
  app.route("/mcp", mcp as unknown as Hono);
  app.route("/.well-known", wellKnown as unknown as Hono);
  return app;
}

async function pkcePair() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

// ── oauth.ts ─────────────────────────────────────────────

test("signed tokens round-trip, and kinds cannot be swapped", async () => {
  const t = await sign("access", { sub: "u" }, SECRET, 60, NOW);
  assert.deepEqual((await verify<{ sub: string }>("access", t, SECRET, NOW))?.sub, "u");
  assert.equal(await verify("refresh", t, SECRET, NOW), null);
  assert.equal(await verify("access", t, "other-secret", NOW), null);
  assert.equal(await verify("access", t, SECRET, NOW + 61_000), null, "expired");
  assert.equal(await verify("access", t.slice(0, -2) + "xx", SECRET, NOW), null, "tampered");
  assert.equal(await verify("access", "a.b.c", SECRET, NOW), null);
});

test("PKCE S256", async () => {
  const { verifier, challenge } = await pkcePair();
  assert.ok(await pkceMatches(verifier, challenge));
  assert.ok(!(await pkceMatches(verifier + "x", challenge)));
  assert.ok(!(await pkceMatches("short", challenge)));
});

test("redirect URIs and return paths", () => {
  assert.ok(validRedirectUri("https://claude.ai/api/mcp/auth_callback"));
  assert.ok(validRedirectUri("http://localhost:33418/callback"));
  assert.ok(!validRedirectUri("http://evil.example/cb"));
  assert.ok(!validRedirectUri("javascript:alert(1)"));
  assert.equal(safeReturnTo("/mcp/authorize?x=1"), "/mcp/authorize?x=1");
  assert.equal(safeReturnTo("//evil.example"), "/");
  assert.equal(safeReturnTo("https://evil.example"), "/");
  assert.equal(safeReturnTo("/\\evil.example"), "/");
});

test("switch: off bumps the generation, which kills old grants", async () => {
  const kv = new FakeKV() as unknown as KVNamespace;
  assert.deepEqual(await readSwitch(kv, "u"), { on: false, gen: 0 });
  const on = await writeSwitch(kv, "u", true);
  assert.ok(grantLive(on, { gen: on.gen }));
  await writeSwitch(kv, "u", false);
  const back = await writeSwitch(kv, "u", true);
  assert.ok(!grantLive(back, { gen: on.gen }), "a token from before the off stays dead");
  assert.ok(grantLive(back, { gen: back.gen }));
});

// ── Tools ────────────────────────────────────────────────

const deps: ToolDeps = { catalog: async () => catalog, forecast: async () => null, now: () => NOW };
const tool = (name: string) => TOOLS.find((t) => t.name === name)!;

test("catalogue finds ids, common names, planets; suggests on a miss", () => {
  assert.equal(catalog.find("M 42")?.id, "M42");
  assert.equal(catalog.find("orion nebula")?.id, "M42");
  assert.equal(catalog.find("Jupiter")?.kind, "planet");
  assert.equal(catalog.find("sirius")?.kind, "star");
  assert.equal(catalog.find("no such thing"), null);
});

test("sky_targets_altaz: samples every 15 min, best time in the dark", async () => {
  const out = (await tool("sky_targets_altaz").run({ targets: ["M42", "nope"], ...SYDNEY, date: "2026-10-18", tz: "Australia/Sydney" }, deps)) as {
    nights: { targets: { id: string; samples: unknown[]; best_dark_time: { alt: number } | null }[] }[];
    not_found: { query: string }[];
  };
  const m42 = out.nights[0].targets[0];
  assert.equal(m42.id, "M42");
  assert.ok(m42.samples.length > 30 && m42.samples.length < 60);
  assert.ok(m42.best_dark_time && m42.best_dark_time.alt > 40, "Orion is high from Sydney before dawn in October");
  assert.equal(out.not_found[0].query, "nope");
});

test("guard rails: too many targets, too many nights, bad lat", async () => {
  const t = tool("sky_targets_altaz");
  await assert.rejects(t.run({ targets: Array(21).fill("M42"), ...SYDNEY }, deps), /at most 20/);
  await assert.rejects(t.run({ targets: ["M42"], ...SYDNEY, nights: 4 }, deps), /nights/);
  await assert.rejects(t.run({ targets: ["M42"], lat: 95, lon: 0 }, deps), /lat/);
});

test("sky_night_window: twilight order and Moon", async () => {
  const out = (await tool("sky_night_window").run({ ...SYDNEY, date: "2026-10-18", nights: 2, targets: ["M31"] }, deps)) as {
    nights: { sunset: string; astronomical_dusk: string; astronomical_dawn: string; sunrise: string; moon: { illumination_pct: number }; moon_separation_deg: { deg: number }[] }[];
  };
  assert.equal(out.nights.length, 2);
  const n = out.nights[0];
  assert.ok(n.sunset < n.astronomical_dusk && n.astronomical_dusk < n.astronomical_dawn && n.astronomical_dawn < n.sunrise);
  assert.ok(n.moon.illumination_pct >= 0 && n.moon.illumination_pct <= 100);
  assert.ok(n.moon_separation_deg[0].deg > 0);
});

test("seestar framing: the biggest object needs a mosaic; M31 and M42 fit", () => {
  const big = ROWS.filter((r) => r[8] != null).sort((x, y) => y[8]! - x[8]!)[0];
  const huge = framing(catalog.find(big[0])!, NOW);
  assert.equal(huge.fits, false);
  assert.ok("mosaic" in huge);
  assert.equal(framing(catalog.find("M31")!, NOW).fits, true, "M31 (178 x 70 arcmin) fits the 4 x 2.2 deg frame");
  assert.equal(framing(catalog.find("M42")!, NOW).fits, true);
  assert.equal(framing(catalog.find("Jupiter")!, NOW).fits, true);
});

// ── End to end: register, sign in, consent, token, call, revoke ─

test("OAuth flow and MCP calls", async () => {
  const app = makeApp();
  const env = makeEnv();
  const base = "https://sky.incitat.io";
  const req = (path: string, init?: RequestInit) => app.request(base + path, init, env, ctx as unknown as ExecutionContext);

  const meta = await (await req("/.well-known/oauth-authorization-server")).json();
  assert.equal(meta.token_endpoint, `${base}/mcp/token`);
  assert.deepEqual(meta.code_challenge_methods_supported, ["S256"]);

  const unauth = await req("/mcp", { method: "POST", body: "{}" });
  assert.equal(unauth.status, 401);
  assert.match(unauth.headers.get("WWW-Authenticate") ?? "", /resource_metadata=/);

  const redirect = "https://claude.ai/api/mcp/auth_callback";
  const reg = await req("/mcp/register", { method: "POST", body: JSON.stringify({ redirect_uris: [redirect], client_name: "Claude" }) });
  assert.equal(reg.status, 201);
  const { client_id } = await reg.json();

  const { verifier, challenge } = await pkcePair();
  const q = new URLSearchParams({ response_type: "code", client_id, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: "S256", state: "s1" });

  // Not signed in: offers SSO, coming back here.
  const signIn = await (await req(`/mcp/authorize?${q}`)).text();
  assert.match(signIn, /\/auth\/google\?returnTo=%2Fmcp%2Fauthorize/);

  const session = await signJWT({ sub: "google-1", email: "rob@example.com", name: "Rob", provider: "google" }, SECRET);
  const cookie = { Cookie: `session=${session}` };

  // Signed in, MCP off: no consent.
  assert.match(await (await req(`/mcp/authorize?${q}`, { headers: cookie })).text(), /Turn on MCP first/);

  await writeSwitch(env.USER_PREFS as unknown as KVNamespace, "google-1", true);
  const consentPage = await (await req(`/mcp/authorize?${q}`, { headers: cookie })).text();
  const consent = /name="consent" value="([^"]+)"/.exec(consentPage)![1];

  // Without the session cookie (cross-site POST), the consent is refused.
  const noCookie = await req("/mcp/authorize", { method: "POST", body: new URLSearchParams({ consent, decision: "allow" }) });
  assert.equal(noCookie.status, 400);

  const approved = await req("/mcp/authorize", { method: "POST", headers: cookie, body: new URLSearchParams({ consent, decision: "allow" }) });
  assert.equal(approved.status, 302);
  const back = new URL(approved.headers.get("Location")!);
  assert.equal(back.origin + back.pathname, redirect);
  assert.equal(back.searchParams.get("state"), "s1");
  const code = back.searchParams.get("code")!;

  const tokenBody = { grant_type: "authorization_code", code, client_id, redirect_uri: redirect };
  const badPkce = await req("/mcp/token", { method: "POST", body: new URLSearchParams({ ...tokenBody, code_verifier: verifier.replace(/.$/, "A") === verifier ? verifier.replace(/.$/, "B") : verifier.replace(/.$/, "A") }) });
  assert.equal(badPkce.status, 400);
  const tok = await (await req("/mcp/token", { method: "POST", body: new URLSearchParams({ ...tokenBody, code_verifier: verifier }) })).json();
  assert.ok(tok.access_token && tok.refresh_token);
  const replay = await req("/mcp/token", { method: "POST", body: new URLSearchParams({ ...tokenBody, code_verifier: verifier }) });
  assert.equal(replay.status, 400, "a code works once");

  const bearer = { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json" };
  const rpc = async (method: string, params: object = {}) =>
    (await req("/mcp", { method: "POST", headers: bearer, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json();

  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
  assert.equal(init.result.protocolVersion, "2025-06-18");
  const list = await rpc("tools/list");
  assert.deepEqual(list.result.tools.map((t: { name: string }) => t.name), ["sky_targets_altaz", "sky_night_window", "sky_weather", "seestar_s30pro_framing"]);
  const call = await rpc("tools/call", { name: "seestar_s30pro_framing", arguments: { targets: ["M42"] } });
  assert.equal(call.result.isError, false);
  const bad = await rpc("tools/call", { name: "sky_targets_altaz", arguments: { targets: [], lat: 0, lon: 0 } });
  assert.equal(bad.result.isError, true);

  // Audit: one row per call, with coarse place only.
  const calls = env.DB.events.filter((e) => e[2] === "mcp_call");
  assert.equal(calls.length, 2);
  assert.match(String(calls[0][3]), /seestar_s30pro_framing/);

  // Refresh works while on; blocked user is cut off; off revokes everything.
  const refreshed = await req("/mcp/token", { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tok.refresh_token, client_id }) });
  assert.equal(refreshed.status, 200);
  env.DB.users.set("google-1", "blocked");
  assert.equal((await req("/mcp", { method: "POST", headers: bearer, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }) })).status, 401);
  env.DB.users.set("google-1", "active");
  await writeSwitch(env.USER_PREFS as unknown as KVNamespace, "google-1", false);
  assert.equal((await req("/mcp", { method: "POST", headers: bearer, body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "ping" }) })).status, 401);
  const deadRefresh = await req("/mcp/token", { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tok.refresh_token }) });
  assert.equal(deadRefresh.status, 400);
});

test("sign-in carries a state that the callback must match", async () => {
  const { default: auth } = await import("../functions/auth/handler.ts");
  const env = { ...makeEnv(), GOOGLE_CLIENT_ID: "gid", GOOGLE_CLIENT_SECRET: "x", MICROSOFT_CLIENT_ID: "mid", MICROSOFT_CLIENT_SECRET: "y" };
  const start = await auth.request("https://sky.incitat.io/google?returnTo=%2Fmcp%2Fauthorize%3Fa%3D1", undefined, env);
  const to = new URL(start.headers.get("Location")!);
  const state = to.searchParams.get("state")!;
  assert.ok(state.length > 10);
  const setCookie = start.headers.get("Set-Cookie")!;
  assert.match(setCookie, /^auth_state=[^;]+; Path=\/auth; HttpOnly; Secure; SameSite=Lax/);
  // Wrong or missing state: refused before any call to Google.
  const cookie = setCookie.split(";")[0];
  const bad = await auth.request(`https://sky.incitat.io/google/callback?code=c&state=nope`, { headers: { Cookie: cookie } }, env);
  assert.equal(bad.status, 400);
  const none = await auth.request(`https://sky.incitat.io/google/callback?code=c&state=${state}`, undefined, env);
  assert.equal(none.status, 400);
});
