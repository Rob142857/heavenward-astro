import { Hono } from "hono";

interface Env {
  DB: D1Database;
}

const admin = new Hono<{ Bindings: Env }>();

// ── Dashboard HTML ──────────────────────────────────────
admin.get("/", async (c) => {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const monthAgo = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);

  // Parallel queries
  const [
    totalUsers,
    usersToday,
    totalEvents,
    eventsToday,
    sessionsToday,
    sessions7d,
    topPages,
    topClicks,
    recentUsers,
    dailyViews,
  ] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) as n FROM users").first<{ n: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as n FROM users WHERE created_at >= ?").bind(today).first<{ n: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as n FROM events").first<{ n: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as n FROM events WHERE ts >= ?").bind(today).first<{ n: number }>(),
    c.env.DB.prepare("SELECT COUNT(DISTINCT session_id) as n FROM events WHERE ts >= ?").bind(today).first<{ n: number }>(),
    c.env.DB.prepare("SELECT COUNT(DISTINCT session_id) as n FROM events WHERE ts >= ?").bind(weekAgo).first<{ n: number }>(),
    c.env.DB.prepare("SELECT path, COUNT(*) as n FROM events WHERE event='pageview' AND ts >= ? GROUP BY path ORDER BY n DESC LIMIT 10").bind(weekAgo).all(),
    c.env.DB.prepare("SELECT detail, COUNT(*) as n FROM events WHERE event='click' AND ts >= ? GROUP BY detail ORDER BY n DESC LIMIT 10").bind(weekAgo).all(),
    c.env.DB.prepare("SELECT id, email, name, provider, email_consent, created_at FROM users ORDER BY created_at DESC LIMIT 20").all(),
    c.env.DB.prepare("SELECT DATE(ts) as day, COUNT(*) as n FROM events WHERE event='pageview' AND ts >= ? GROUP BY DATE(ts) ORDER BY day").bind(monthAgo).all(),
  ]);

  const tableRows = (rows: unknown[]): string =>
    rows.map((r: unknown) => {
      const row = r as Record<string, unknown>;
      return `<tr>${Object.values(row).map((v) => `<td>${esc(String(v ?? ""))}</td>`).join("")}</tr>`;
    }).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Heavenward Admin</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0e1a;color:#e0e6f0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:24px;max-width:1200px;margin:0 auto}
h1{font-size:1.6rem;color:#f5e6a3;margin-bottom:24px}
h2{font-size:1rem;color:#d4af37;margin:28px 0 12px;text-transform:uppercase;letter-spacing:.1em;font-weight:400}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:24px}
.stat{background:#111827;border:1px solid #1e2a42;border-radius:12px;padding:16px;text-align:center}
.stat .n{font-size:2rem;font-weight:700;color:#f5e6a3}
.stat .l{font-size:.75rem;color:#7b869c;margin-top:4px;text-transform:uppercase;letter-spacing:.05em}
table{width:100%;border-collapse:collapse;background:#111827;border:1px solid #1e2a42;border-radius:12px;overflow:hidden;margin-bottom:16px;font-size:.85rem}
th{background:#1a2236;text-align:left;padding:10px 14px;color:#7b869c;font-weight:600;font-size:.72rem;text-transform:uppercase;letter-spacing:.05em}
td{padding:8px 14px;border-top:1px solid #1e2a42;color:#e0e6f0}
tr:hover td{background:rgba(212,175,55,.04)}
.chart{background:#111827;border:1px solid #1e2a42;border-radius:12px;padding:16px;margin-bottom:16px}
.bars{display:flex;align-items:flex-end;gap:4px;height:120px}
.bar-col{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px}
.bar{background:linear-gradient(to top,#b8942e,#f5e6a3);border-radius:3px 3px 0 0;min-width:12px;width:100%}
.bar-label{font-size:.6rem;color:#7b869c;writing-mode:vertical-lr;transform:rotate(180deg)}
.bar-n{font-size:.65rem;color:#f5e6a3}
.btn{display:inline-block;padding:10px 20px;border-radius:8px;border:none;font-size:.85rem;font-weight:600;cursor:pointer;background:#d4af37;color:#0a0e1a;margin-top:8px}
.btn:hover{background:#f5e6a3}
.consent{display:inline-block;width:8px;height:8px;border-radius:50%}
.consent.yes{background:#66bb6a}
.consent.no{background:#7b869c}
textarea{width:100%;min-height:120px;background:#111827;border:1px solid #1e2a42;border-radius:10px;color:#e0e6f0;padding:12px;font-size:.85rem;font-family:inherit;resize:vertical;margin-bottom:8px}
#email-result{font-size:.82rem;color:#7b869c;margin-top:8px}
</style></head><body>
<h1>✦ Heavenward Admin</h1>

<div class="stats">
<div class="stat"><div class="n">${totalUsers?.n ?? 0}</div><div class="l">Total Users</div></div>
<div class="stat"><div class="n">${usersToday?.n ?? 0}</div><div class="l">New Today</div></div>
<div class="stat"><div class="n">${sessionsToday?.n ?? 0}</div><div class="l">Sessions Today</div></div>
<div class="stat"><div class="n">${sessions7d?.n ?? 0}</div><div class="l">Sessions 7d</div></div>
<div class="stat"><div class="n">${eventsToday?.n ?? 0}</div><div class="l">Events Today</div></div>
<div class="stat"><div class="n">${totalEvents?.n ?? 0}</div><div class="l">Total Events</div></div>
</div>

<h2>Page Views — Last 30 Days</h2>
<div class="chart">
<div class="bars">
${(dailyViews.results ?? []).map((r: unknown) => {
  const row = r as Record<string, unknown>;
  const max = Math.max(...(dailyViews.results ?? []).map((x: unknown) => Number((x as Record<string, unknown>).n)));
  const pct = max > 0 ? (Number(row.n) / max) * 100 : 0;
  const day = String(row.day).slice(5);
  return `<div class="bar-col"><div class="bar-n">${row.n}</div><div class="bar" style="height:${pct}%"></div><div class="bar-label">${day}</div></div>`;
}).join("")}
</div>
</div>

<h2>Top Pages (7d)</h2>
<table><tr><th>Path</th><th>Views</th></tr>${tableRows(topPages.results ?? [])}</table>

<h2>Top Object Clicks (7d)</h2>
<table><tr><th>Object</th><th>Clicks</th></tr>${tableRows(topClicks.results ?? [])}</table>

<h2>Users</h2>
<table>
<tr><th>ID</th><th>Email</th><th>Name</th><th>Provider</th><th>Email</th><th>Created</th></tr>
${(recentUsers.results ?? []).map((r: unknown) => {
  const u = r as Record<string, unknown>;
  return `<tr><td style="font-size:.7rem">${esc(String(u.id))}</td><td>${esc(String(u.email))}</td><td>${esc(String(u.name))}</td><td>${u.provider}</td><td><span class="consent ${Number(u.email_consent) ? "yes" : "no"}"></span></td><td>${String(u.created_at).slice(0, 10)}</td></tr>`;
}).join("")}
</table>

<h2>Send Email to All Users</h2>
<p style="font-size:.78rem;color:#7b869c;margin-bottom:12px">Drafts an email list of all users with email consent. Use with your preferred email service.</p>
<button class="btn" onclick="fetchEmails()">Export Email List</button>
<div id="email-result"></div>

<script>
async function fetchEmails(){
  const r=await fetch("/admin/emails");
  const d=await r.json();
  const el=document.getElementById("email-result");
  if(d.ok){
    el.innerHTML="<strong>"+d.data.length+" recipients:</strong><br><textarea readonly>"+d.data.join(", ")+"</textarea>";
  }else{
    el.textContent="Error: "+d.error;
  }
}
</script>
</body></html>`;

  return c.html(html);
});

// ── Email list endpoint ─────────────────────────────────
admin.get("/emails", async (c) => {
  const result = await c.env.DB.prepare(
    "SELECT email FROM users ORDER BY created_at",
  ).all();
  const emails = (result.results ?? []).map(
    (r: unknown) => (r as Record<string, string>).email,
  );
  return c.json({ ok: true, data: emails });
});

// ── Raw events query ────────────────────────────────────
admin.get("/events", async (c) => {
  const limit = Math.min(Number(c.req.query("limit")) || 100, 1000);
  const result = await c.env.DB.prepare(
    "SELECT * FROM events ORDER BY ts DESC LIMIT ?",
  )
    .bind(limit)
    .all();
  return c.json({ ok: true, data: result.results });
});

// ── Stats summary (JSON) ───────────────────────────────
admin.get("/stats", async (c) => {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);

  const [users, sessions7d, events7d] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) as n FROM users").first<{ n: number }>(),
    c.env.DB.prepare("SELECT COUNT(DISTINCT session_id) as n FROM events WHERE ts >= ?").bind(weekAgo).first<{ n: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as n FROM events WHERE ts >= ?").bind(weekAgo).first<{ n: number }>(),
  ]);

  return c.json({
    ok: true,
    data: {
      totalUsers: users?.n ?? 0,
      sessions7d: sessions7d?.n ?? 0,
      events7d: events7d?.n ?? 0,
    },
  });
});

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export default admin;
