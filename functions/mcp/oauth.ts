// OAuth 2.1 pieces for the read-only MCP at /mcp.
//
// Everything a client holds (client id, auth code, access and refresh tokens)
// is a short signed token, so the flow needs no new storage: KV is eventually
// consistent across locations, and Claude's servers redeem codes from a
// different location than the browser that approved them. The only state is
// the per-account switch in USER_PREFS (`mcp:on:<user>`), whose generation
// number is baked into every token: turning MCP off bumps it, which kills
// every token for that account.

export const ACCESS_TTL = 3600; // 1 h
export const REFRESH_TTL = 30 * 86400; // 30 days
export const CODE_TTL = 300; // 5 min
export const CONSENT_TTL = 600; // 10 min to press Allow

export type TokenKind = "client" | "code" | "access" | "refresh" | "consent";

export interface ClientClaims {
  /** Allowed redirect URIs. */
  r: string[];
  /** Client name, shown on the consent page. */
  n: string;
}

export interface GrantClaims {
  /** User id (users.id). */
  sub: string;
  /** Client id the grant belongs to. */
  cid: string;
  /** Account MCP generation at grant time. */
  gen: number;
}

export interface CodeClaims extends GrantClaims {
  /** redirect_uri the code was issued to. */
  ru: string;
  /** PKCE S256 challenge. */
  cc: string;
  /** One-time id, so a code can be marked used. */
  jti: string;
}

const enc = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad + "===".slice((pad.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
}

export function randomId(bytes = 16): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

// Separate key from the session JWT, so a session cookie can never pass as an
// MCP token or the other way round.
function mcpKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(`${secret}|heavenward-mcp-v1`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Sign `claims` as a `kind` token valid for `ttl` seconds (0 = no expiry). */
export async function sign(
  kind: TokenKind,
  claims: object,
  secret: string,
  ttl: number,
  now = Date.now(),
): Promise<string> {
  const body = { ...claims, k: kind, exp: ttl ? Math.floor(now / 1000) + ttl : 0 };
  const data = b64url(enc.encode(JSON.stringify(body)));
  const sig = await crypto.subtle.sign("HMAC", await mcpKey(secret), enc.encode(`${kind}.${data}`));
  return `${data}.${b64url(new Uint8Array(sig))}`;
}

/** Claims of a valid, unexpired `kind` token, else null. */
export async function verify<T>(
  kind: TokenKind,
  token: string | null | undefined,
  secret: string,
  now = Date.now(),
): Promise<T | null> {
  if (!token || token.length > 4096) return null;
  const dot = token.indexOf(".");
  if (dot < 1 || token.indexOf(".", dot + 1) !== -1) return null;
  const data = token.slice(0, dot);
  let ok = false;
  try {
    ok = await crypto.subtle.verify(
      "HMAC",
      await mcpKey(secret),
      fromB64url(token.slice(dot + 1)),
      enc.encode(`${kind}.${data}`),
    );
  } catch {
    return null;
  }
  if (!ok) return null;
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(new TextDecoder().decode(fromB64url(data)));
  } catch {
    return null;
  }
  if (body.k !== kind) return null;
  if (typeof body.exp !== "number") return null;
  if (body.exp !== 0 && body.exp < Math.floor(now / 1000)) return null;
  return body as T;
}

/** PKCE S256: base64url(sha256(verifier)) === challenge. */
export async function pkceMatches(verifier: string, challenge: string): Promise<boolean> {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(verifier));
  return b64url(new Uint8Array(digest)) === challenge;
}

const CLAUDE_HOSTS = ["claude.ai", "claude.com"];

/** Redirect URIs a client may register: Claude's callback, or loopback. */
export function validRedirectUri(uri: unknown): uri is string {
  if (typeof uri !== "string" || uri.length > 512) return false;
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash || u.username || u.password) return false;
  // Claude's connector callback (claude.ai or claude.com), or a loopback
  // listener (Claude Code). Anything else could pose as Claude on the
  // consent page and walk off with a code.
  if (u.protocol === "https:" && CLAUDE_HOSTS.includes(u.hostname)) return u.pathname === "/api/mcp/auth_callback";
  return (u.protocol === "http:" || u.protocol === "https:") && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
}

/** A same-site path to come back to after sign-in ("/mcp/authorize?..."), else "/". */
export function safeReturnTo(v: unknown): string {
  if (typeof v !== "string" || v.length > 2048) return "/";
  // Control characters and spaces first: browsers strip tabs/newlines, so
  // "/\t/evil.com" would become "//evil.com".
  if (!v.startsWith("/") || /[\x00-\x20\\]/.test(v)) return "/";
  const base = "https://sky.incitat.io";
  let u: URL;
  try {
    u = new URL(v, base);
  } catch {
    return "/";
  }
  return u.origin === base ? u.pathname + u.search : "/";
}

// ── Per-account switch ────────────────────────────────────

export interface McpSwitch {
  on: boolean;
  gen: number;
}

export const switchKey = (user: string) => `mcp:on:${user}`;

export async function readSwitch(kv: KVNamespace, user: string): Promise<McpSwitch> {
  const raw = await kv.get(switchKey(user));
  if (!raw) return { on: false, gen: 0 };
  try {
    const v = JSON.parse(raw) as Partial<McpSwitch>;
    return { on: v.on === true, gen: typeof v.gen === "number" ? v.gen : 0 };
  } catch {
    return { on: false, gen: 0 };
  }
}

/** Turn MCP on or off. Off bumps the generation, which revokes every token. */
export async function writeSwitch(kv: KVNamespace, user: string, on: boolean): Promise<McpSwitch> {
  const cur = await readSwitch(kv, user);
  const next = { on, gen: on ? cur.gen : cur.gen + 1 };
  await kv.put(switchKey(user), JSON.stringify(next));
  return next;
}

/** A grant is live while MCP is on and the generation has not moved. */
export function grantLive(sw: McpSwitch, g: Pick<GrantClaims, "gen">): boolean {
  return sw.on && sw.gen === g.gen;
}
