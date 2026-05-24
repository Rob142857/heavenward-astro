import { Hono } from "hono";

interface Env {
  DB: D1Database;
}

const admin = new Hono<{ Bindings: Env }>();

function rangeStart(days: number): string {
  return new Date(Date.now() - days * 86400000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

function fmtDuration(ms: number): string {
  if (!ms || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shortUA(ua: string | null): string {
  if (!ua) return "—";
  // crude UA classification
  if (/iPhone|iPad/.test(ua)) return "iOS Safari";
  if (/Android/.test(ua) && /Chrome/.test(ua)) return "Android Chrome";
  if (/Edg\//.test(ua)) return "Edge";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua)) return "Safari";
  return ua.slice(0, 40);
}

// ── Dashboard HTML ──────────────────────────────────────
admin.get("/", async (c) => {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const weekAgo = new Date(now.getTime() - 7 * 86400000)
    .toISOString()
    .slice(0, 10);
  const monthAgo = new Date(now.getTime() - 30 * 86400000)
    .toISOString()
    .slice(0, 10);

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
    dailyViews,
  ] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) as n FROM users").first<{ n: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as n FROM users WHERE created_at >= ?")
      .bind(today)
      .first<{ n: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as n FROM events").first<{ n: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as n FROM events WHERE ts >= ?")
      .bind(today)
      .first<{ n: number }>(),
    c.env.DB.prepare(
      "SELECT COUNT(DISTINCT session_id) as n FROM events WHERE ts >= ?",
    )
      .bind(today)
      .first<{ n: number }>(),
    c.env.DB.prepare(
      "SELECT COUNT(DISTINCT session_id) as n FROM events WHERE ts >= ?",
    )
      .bind(weekAgo)
      .first<{ n: number }>(),
    c.env.DB.prepare(
      "SELECT path, COUNT(*) as n FROM events WHERE event='pageview' AND ts >= ? GROUP BY path ORDER BY n DESC LIMIT 10",
    )
      .bind(weekAgo)
      .all(),
    c.env.DB.prepare(
      "SELECT detail, COUNT(*) as n FROM events WHERE event='click' AND ts >= ? GROUP BY detail ORDER BY n DESC LIMIT 10",
    )
      .bind(weekAgo)
      .all(),
    c.env.DB.prepare(
      "SELECT DATE(ts) as day, COUNT(*) as n FROM events WHERE event='pageview' AND ts >= ? GROUP BY DATE(ts) ORDER BY day",
    )
      .bind(monthAgo)
      .all(),
  ]);

  const tableRows = (rows: unknown[]): string =>
    rows
      .map((r: unknown) => {
        const row = r as Record<string, unknown>;
        return `<tr>${Object.values(row)
          .map((v) => `<td>${esc(String(v ?? ""))}</td>`)
          .join("")}</tr>`;
      })
      .join("");

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
.rangebtn{background:#1a2236;color:#e0e6f0;border:1px solid #1e2a42;padding:6px 14px;border-radius:8px;font-size:.78rem;cursor:pointer;margin-left:4px}
.rangebtn.active{background:#d4af37;color:#0a0e1a;border-color:#d4af37;font-weight:600}
.rangebtn:hover{border-color:#d4af37}
#audit-sessions tr[data-sid]:hover td{background:rgba(212,175,55,.08)}
.status-badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:.68rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em}
.st-active{background:rgba(102,187,106,.15);color:#66bb6a;border:1px solid rgba(102,187,106,.3)}
.st-paused{background:rgba(245,230,163,.15);color:#f5e6a3;border:1px solid rgba(245,230,163,.3)}
.st-blocked{background:rgba(255,167,38,.15);color:#ffa726;border:1px solid rgba(255,167,38,.3)}
.st-banned{background:rgba(239,83,80,.15);color:#ef5350;border:1px solid rgba(239,83,80,.3)}
#users-table tr[data-uid]:hover td{background:rgba(212,175,55,.08)}
.btn[disabled]{opacity:.45;cursor:not-allowed}
.st-btn-paused{background:#f5e6a3}
.st-btn-blocked{background:#ffa726}
.st-btn-banned{background:#ef5350;color:#fff}
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
${(dailyViews.results ?? [])
  .map((r: unknown) => {
    const row = r as Record<string, unknown>;
    const max = Math.max(
      ...(dailyViews.results ?? []).map((x: unknown) =>
        Number((x as Record<string, unknown>).n),
      ),
    );
    const pct = max > 0 ? (Number(row.n) / max) * 100 : 0;
    const day = String(row.day).slice(5);
    return `<div class="bar-col"><div class="bar-n">${row.n}</div><div class="bar" style="height:${pct}%"></div><div class="bar-label">${day}</div></div>`;
  })
  .join("")}
</div>
</div>

<h2>Top Pages (7d)</h2>
<table><tr><th>Path</th><th>Views</th></tr>${tableRows(topPages.results ?? [])}</table>

<h2>Top Object Clicks (7d)</h2>
<table><tr><th>Object</th><th>Clicks</th></tr>${tableRows(topClicks.results ?? [])}</table>

<h2>Users <span id="user-counts" style="font-size:.7rem;color:#7b869c;font-weight:400;text-transform:none;letter-spacing:0;margin-left:8px"></span></h2>
<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:center">
  <input id="user-search" placeholder="Search email, name, or id…" style="flex:1;min-width:220px;background:#111827;border:1px solid #1e2a42;color:#e0e6f0;border-radius:8px;padding:8px 12px;font-size:.85rem">
  <select id="user-status" style="background:#111827;border:1px solid #1e2a42;color:#e0e6f0;border-radius:8px;padding:8px 12px;font-size:.85rem">
    <option value="">All statuses</option>
    <option value="active">Active</option>
    <option value="paused">Paused</option>
    <option value="blocked">Blocked</option>
    <option value="banned">Banned</option>
  </select>
  <button class="btn" id="user-search-btn" style="padding:8px 16px;font-size:.8rem">Search</button>
</div>
<div id="users-table"></div>
<div id="users-pager" style="display:flex;gap:8px;align-items:center;justify-content:center;margin-top:10px;font-size:.8rem;color:#7b869c"></div>
<div id="user-detail" style="display:none;margin-top:16px"></div>

<h2>Send Email to All Users</h2>
<p style="font-size:.78rem;color:#7b869c;margin-bottom:12px">Drafts an email list of all users with email consent. Use with your preferred email service.</p>
<button class="btn" onclick="fetchEmails()">Export Email List</button>
<div id="email-result"></div>

<h2 style="display:flex;align-items:center;gap:12px">Audit Log
  <span style="margin-left:auto">
    <button class="rangebtn active" data-days="7">7d</button>
    <button class="rangebtn" data-days="30">30d</button>
  </span>
</h2>
<div id="audit-summary" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:12px"></div>
<div id="audit-sessions"></div>
<div id="audit-detail" style="display:none"></div>

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

let currentDays=7;
function fmtDur(ms){
  if(!ms||ms<0) return "—";
  const s=Math.round(ms/1000);
  if(s<60) return s+"s";
  const m=Math.floor(s/60), rs=s%60;
  if(m<60) return m+"m "+rs+"s";
  const h=Math.floor(m/60);
  return h+"h "+(m%60)+"m";
}
function escapeHtml(s){
  return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
async function loadAudit(days){
  currentDays=days;
  document.querySelectorAll(".rangebtn").forEach(b=>b.classList.toggle("active",Number(b.dataset.days)===days));
  document.getElementById("audit-detail").style.display="none";
  const r=await fetch("/admin/audit?days="+days);
  const d=await r.json();
  if(!d.ok){document.getElementById("audit-sessions").textContent="Error: "+d.error;return;}
  const s=d.data.summary;
  document.getElementById("audit-summary").innerHTML=
    '<div class="stat"><div class="n">'+s.sessions+'</div><div class="l">Sessions</div></div>'+
    '<div class="stat"><div class="n">'+s.pageviews+'</div><div class="l">Pageviews</div></div>'+
    '<div class="stat"><div class="n">'+s.uniqueIps+'</div><div class="l">Unique IPs</div></div>'+
    '<div class="stat"><div class="n">'+s.countries+'</div><div class="l">Countries</div></div>'+
    '<div class="stat"><div class="n">'+fmtDur(s.avgSessionMs)+'</div><div class="l">Avg Session</div></div>'+
    '<div class="stat"><div class="n">'+fmtDur(s.avgDwellMs)+'</div><div class="l">Avg Dwell</div></div>';
  const rows=d.data.sessions.map(function(x){
    const loc=[x.city,x.region,x.country].filter(Boolean).join(", ")||"—";
    return '<tr data-sid="'+escapeHtml(x.session_id)+'" style="cursor:pointer">'+
      '<td style="font-family:ui-monospace,monospace;font-size:.72rem">'+escapeHtml(x.session_id.slice(0,8))+'</td>'+
      '<td>'+escapeHtml(x.started_at.replace("T"," ").slice(0,16))+'</td>'+
      '<td>'+fmtDur(x.duration_ms)+'</td>'+
      '<td style="text-align:right">'+x.pageviews+'</td>'+
      '<td style="text-align:right">'+x.clicks+'</td>'+
      '<td>'+escapeHtml(loc)+'</td>'+
      '<td style="font-family:ui-monospace,monospace;font-size:.72rem">'+escapeHtml(x.ip||"—")+'</td>'+
      '<td>'+escapeHtml(x.ua_short||"—")+'</td>'+
    '</tr>';
  }).join("");
  document.getElementById("audit-sessions").innerHTML=
    '<table><tr><th>Session</th><th>Started</th><th>Duration</th><th>Views</th><th>Clicks</th><th>Location</th><th>IP</th><th>Client</th></tr>'+rows+'</table>'+
    '<p style="font-size:.72rem;color:#7b869c;margin-top:6px">Click a row for full navigation timeline.</p>';
  document.querySelectorAll("#audit-sessions tr[data-sid]").forEach(function(tr){
    tr.addEventListener("click",function(){loadSession(tr.dataset.sid);});
  });
}
async function loadSession(sid){
  const r=await fetch("/admin/audit/session?sid="+encodeURIComponent(sid));
  const d=await r.json();
  const el=document.getElementById("audit-detail");
  el.style.display="block";
  if(!d.ok){el.textContent="Error: "+d.error;return;}
  const meta=d.data.meta;
  const rows=d.data.events.map(function(e){
    return '<tr>'+
      '<td style="font-family:ui-monospace,monospace;font-size:.72rem">'+escapeHtml(e.ts.replace("T"," ").slice(0,19))+'</td>'+
      '<td>'+escapeHtml(e.event)+'</td>'+
      '<td>'+escapeHtml(e.path)+'</td>'+
      '<td>'+escapeHtml(e.detail||"")+'</td>'+
      '<td style="text-align:right">'+(e.dwell_ms?fmtDur(e.dwell_ms):"—")+'</td>'+
    '</tr>';
  }).join("");
  const loc=[meta.city,meta.region,meta.country].filter(Boolean).join(", ")||"—";
  el.innerHTML='<h2>Session '+escapeHtml(sid.slice(0,8))+' <button class="btn" style="margin-left:12px;padding:4px 12px;font-size:.7rem" onclick="document.getElementById(\\'audit-detail\\').style.display=\\'none\\'">close</button></h2>'+
    '<div style="background:#111827;border:1px solid #1e2a42;border-radius:12px;padding:14px;margin-bottom:12px;font-size:.82rem;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px">'+
    '<div><span style="color:#7b869c">IP:</span> '+escapeHtml(meta.ip||"—")+'</div>'+
    '<div><span style="color:#7b869c">Location:</span> '+escapeHtml(loc)+'</div>'+
    '<div><span style="color:#7b869c">Timezone:</span> '+escapeHtml(meta.tz||"—")+'</div>'+
    '<div><span style="color:#7b869c">Referrer:</span> '+escapeHtml(meta.referrer||"—")+'</div>'+
    '<div><span style="color:#7b869c">First seen:</span> '+escapeHtml((meta.first_seen||"").replace("T"," ").slice(0,19))+'</div>'+
    '<div><span style="color:#7b869c">Last seen:</span> '+escapeHtml((meta.last_seen||"").replace("T"," ").slice(0,19))+'</div>'+
    '<div style="grid-column:1/-1"><span style="color:#7b869c">User-Agent:</span> <span style="font-family:ui-monospace,monospace;font-size:.7rem">'+escapeHtml(meta.ua||"—")+'</span></div>'+
    '</div>'+
    '<table><tr><th>Time</th><th>Event</th><th>Path</th><th>Detail</th><th>Dwell</th></tr>'+rows+'</table>';
  el.scrollIntoView({behavior:"smooth",block:"start"});
}
document.querySelectorAll(".rangebtn").forEach(function(b){
  b.addEventListener("click",function(){loadAudit(Number(b.dataset.days));});
});
loadAudit(7);

// ── User management ──
let userOffset=0;
const USER_LIMIT=50;
async function loadUsers(reset){
  if(reset) userOffset=0;
  const q=document.getElementById("user-search").value.trim();
  const st=document.getElementById("user-status").value;
  const params=new URLSearchParams({limit:String(USER_LIMIT),offset:String(userOffset)});
  if(q) params.set("q",q);
  if(st) params.set("status",st);
  const r=await fetch("/admin/users?"+params.toString());
  const d=await r.json();
  if(!d.ok){document.getElementById("users-table").textContent="Error: "+d.error;return;}
  const sc=d.data.statusCounts;
  document.getElementById("user-counts").textContent=
    d.data.total+" matches · "+sc.active+" active · "+sc.paused+" paused · "+sc.blocked+" blocked · "+sc.banned+" banned";
  const rows=d.data.users.map(function(u){
    const loc=[u.last_login_city,u.last_login_country].filter(Boolean).join(", ")||"—";
    const last=u.last_login_at?u.last_login_at.replace("T"," ").slice(0,16):"never";
    const badge='<span class="status-badge st-'+u.status+'">'+u.status+'</span>';
    return '<tr data-uid="'+escapeHtml(u.id)+'" style="cursor:pointer">'+
      '<td>'+escapeHtml(u.email)+'</td>'+
      '<td>'+escapeHtml(u.name)+'</td>'+
      '<td>'+escapeHtml(u.provider)+'</td>'+
      '<td>'+badge+'</td>'+
      '<td style="text-align:right">'+(u.login_count||0)+'</td>'+
      '<td>'+escapeHtml(last)+'</td>'+
      '<td>'+escapeHtml(loc)+'</td>'+
      '<td style="font-family:ui-monospace,monospace;font-size:.7rem">'+escapeHtml(u.last_login_ip||"—")+'</td>'+
    '</tr>';
  }).join("");
  document.getElementById("users-table").innerHTML=
    '<table><tr><th>Email</th><th>Name</th><th>Provider</th><th>Status</th><th>Logins</th><th>Last Login</th><th>Location</th><th>Last IP</th></tr>'+rows+'</table>';
  document.querySelectorAll("#users-table tr[data-uid]").forEach(function(tr){
    tr.addEventListener("click",function(){loadUserDetail(tr.dataset.uid);});
  });
  const total=d.data.total;
  const page=Math.floor(userOffset/USER_LIMIT)+1;
  const pages=Math.max(1,Math.ceil(total/USER_LIMIT));
  document.getElementById("users-pager").innerHTML=
    '<button class="btn" style="padding:6px 12px;font-size:.75rem" '+(userOffset===0?"disabled":"")+' id="prev-pg">← Prev</button>'+
    '<span>Page '+page+' / '+pages+'</span>'+
    '<button class="btn" style="padding:6px 12px;font-size:.75rem" '+(userOffset+USER_LIMIT>=total?"disabled":"")+' id="next-pg">Next →</button>';
  const prev=document.getElementById("prev-pg");
  const next=document.getElementById("next-pg");
  if(prev) prev.addEventListener("click",function(){userOffset=Math.max(0,userOffset-USER_LIMIT);loadUsers(false);});
  if(next) next.addEventListener("click",function(){userOffset+=USER_LIMIT;loadUsers(false);});
}
async function loadUserDetail(uid){
  const r=await fetch("/admin/users/"+encodeURIComponent(uid));
  const d=await r.json();
  const el=document.getElementById("user-detail");
  el.style.display="block";
  if(!d.ok){el.textContent="Error: "+d.error;return;}
  const u=d.data.user, t=d.data.totals;
  const loginRows=d.data.logins.map(function(l){
    return '<tr><td>'+escapeHtml((l.ts||"").replace("T"," ").slice(0,19))+'</td>'+
      '<td style="font-family:ui-monospace,monospace;font-size:.72rem">'+escapeHtml(l.ip||"—")+'</td>'+
      '<td>'+escapeHtml([l.city,l.country].filter(Boolean).join(", ")||"—")+'</td>'+
      '<td style="font-size:.72rem">'+escapeHtml((l.ua||"").slice(0,60))+'</td></tr>';
  }).join("") || '<tr><td colspan="4" style="color:#7b869c">No login events recorded.</td></tr>';
  const sessRows=d.data.sessions.map(function(s){
    return '<tr><td style="font-family:ui-monospace,monospace;font-size:.72rem">'+escapeHtml(s.session_id.slice(0,8))+'</td>'+
      '<td>'+escapeHtml((s.started_at||"").replace("T"," ").slice(0,16))+'</td>'+
      '<td>'+fmtDur(s.duration_ms||0)+'</td>'+
      '<td style="text-align:right">'+(s.pageviews||0)+'</td>'+
      '<td>'+escapeHtml([s.city,s.country].filter(Boolean).join(", ")||"—")+'</td>'+
      '<td style="font-family:ui-monospace,monospace;font-size:.72rem">'+escapeHtml(s.ip||"—")+'</td></tr>';
  }).join("") || '<tr><td colspan="6" style="color:#7b869c">No sessions recorded.</td></tr>';
  const adminRows=d.data.adminLog.map(function(a){
    return '<tr><td>'+escapeHtml((a.ts||"").replace("T"," ").slice(0,19))+'</td>'+
      '<td>'+escapeHtml(a.actor_email||"—")+'</td>'+
      '<td>'+escapeHtml(a.action)+'</td>'+
      '<td>'+escapeHtml(a.detail||"")+'</td></tr>';
  }).join("") || '<tr><td colspan="4" style="color:#7b869c">No admin actions on this account.</td></tr>';
  el.innerHTML=
    '<h2 style="display:flex;align-items:center;gap:12px">'+escapeHtml(u.email)+
      ' <span class="status-badge st-'+u.status+'">'+u.status+'</span>'+
      '<button class="btn" style="margin-left:auto;padding:4px 12px;font-size:.7rem" onclick="document.getElementById(\\'user-detail\\').style.display=\\'none\\'">close</button>'+
    '</h2>'+
    '<div style="background:#111827;border:1px solid #1e2a42;border-radius:12px;padding:14px;margin-bottom:12px;font-size:.82rem;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px">'+
      '<div><span style="color:#7b869c">User ID:</span> <span style="font-family:ui-monospace,monospace;font-size:.7rem">'+escapeHtml(u.id)+'</span></div>'+
      '<div><span style="color:#7b869c">Name:</span> '+escapeHtml(u.name)+'</div>'+
      '<div><span style="color:#7b869c">Provider:</span> '+escapeHtml(u.provider)+'</div>'+
      '<div><span style="color:#7b869c">Created:</span> '+escapeHtml((u.created_at||"").slice(0,19).replace("T"," "))+'</div>'+
      '<div><span style="color:#7b869c">Last login:</span> '+escapeHtml((u.last_login_at||"never").replace("T"," ").slice(0,19))+'</div>'+
      '<div><span style="color:#7b869c">Login count:</span> '+(u.login_count||0)+'</div>'+
      '<div><span style="color:#7b869c">Last IP:</span> <span style="font-family:ui-monospace,monospace;font-size:.72rem">'+escapeHtml(u.last_login_ip||"—")+'</span></div>'+
      '<div><span style="color:#7b869c">Last location:</span> '+escapeHtml([u.last_login_city,u.last_login_country].filter(Boolean).join(", ")||"—")+'</div>'+
      '<div><span style="color:#7b869c">Sessions:</span> '+(t.sessions||0)+'</div>'+
      '<div><span style="color:#7b869c">Pageviews:</span> '+(t.pageviews||0)+'</div>'+
      '<div><span style="color:#7b869c">Clicks:</span> '+(t.clicks||0)+'</div>'+
      '<div><span style="color:#7b869c">Total dwell:</span> '+fmtDur(t.total_dwell_ms||0)+'</div>'+
      (u.status_reason?'<div style="grid-column:1/-1;color:#f5e6a3"><span style="color:#7b869c">Status reason:</span> '+escapeHtml(u.status_reason)+' <span style="color:#7b869c">by</span> '+escapeHtml(u.status_changed_by||"")+' '+escapeHtml((u.status_changed_at||"").replace("T"," ").slice(0,16))+'</div>':"")+
    '</div>'+
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">'+
      ['active','paused','blocked','banned'].map(function(s){
        return '<button class="btn statbtn st-btn-'+s+'" data-status="'+s+'" '+(u.status===s?'disabled':'')+'>'+
          (s==='active'?'Reinstate':s.charAt(0).toUpperCase()+s.slice(1))+'</button>';
      }).join("")+
    '</div>'+
    '<h2 style="font-size:.85rem">Last 10 Logins</h2>'+
    '<table><tr><th>Time</th><th>IP</th><th>Location</th><th>User-Agent</th></tr>'+loginRows+'</table>'+
    '<h2 style="font-size:.85rem">Recent Sessions</h2>'+
    '<table><tr><th>Session</th><th>Started</th><th>Duration</th><th>Views</th><th>Location</th><th>IP</th></tr>'+sessRows+'</table>'+
    '<h2 style="font-size:.85rem">Admin Actions</h2>'+
    '<table><tr><th>Time</th><th>Actor</th><th>Action</th><th>Reason</th></tr>'+adminRows+'</table>';
  el.querySelectorAll(".statbtn").forEach(function(b){
    b.addEventListener("click",function(){updateStatus(uid,b.dataset.status);});
  });
  el.scrollIntoView({behavior:"smooth",block:"start"});
}
async function updateStatus(uid,status){
  let reason="";
  if(status!=="active"){
    reason=prompt("Reason for "+status+" (optional):","")||"";
  }else{
    reason=prompt("Note on reinstatement (optional):","")||"";
  }
  const r=await fetch("/admin/users/"+encodeURIComponent(uid)+"/status",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({status:status,reason:reason})
  });
  const d=await r.json();
  if(!d.ok){alert("Failed: "+d.error);return;}
  await loadUserDetail(uid);
  await loadUsers(false);
}
document.getElementById("user-search-btn").addEventListener("click",function(){loadUsers(true);});
document.getElementById("user-search").addEventListener("keydown",function(e){if(e.key==="Enter") loadUsers(true);});
document.getElementById("user-status").addEventListener("change",function(){loadUsers(true);});
loadUsers(true);
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
  const weekAgo = new Date(now.getTime() - 7 * 86400000)
    .toISOString()
    .slice(0, 10);

  const [users, sessions7d, events7d] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) as n FROM users").first<{ n: number }>(),
    c.env.DB.prepare(
      "SELECT COUNT(DISTINCT session_id) as n FROM events WHERE ts >= ?",
    )
      .bind(weekAgo)
      .first<{ n: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) as n FROM events WHERE ts >= ?")
      .bind(weekAgo)
      .first<{ n: number }>(),
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

// ── Audit log: rolling 7d/30d session list with geo/IP ──
admin.get("/audit", async (c) => {
  const days = Math.max(1, Math.min(90, Number(c.req.query("days")) || 7));
  const start = rangeStart(days);

  // Per-session aggregation. Pick latest non-null IP/geo/UA per session.
  const sessionsResult = await c.env.DB.prepare(
    `SELECT
       session_id,
       MIN(ts) AS started_at,
       MAX(ts) AS last_ts,
       (julianday(MAX(ts)) - julianday(MIN(ts))) * 86400000 AS duration_ms,
       SUM(CASE WHEN event='pageview' THEN 1 ELSE 0 END) AS pageviews,
       SUM(CASE WHEN event='click' THEN 1 ELSE 0 END) AS clicks,
       MAX(ip) AS ip,
       MAX(country) AS country,
       MAX(region) AS region,
       MAX(city) AS city,
       MAX(tz) AS tz,
       MAX(ua) AS ua
     FROM events
     WHERE ts >= ?
     GROUP BY session_id
     ORDER BY MIN(ts) DESC
     LIMIT 500`,
  )
    .bind(start)
    .all();

  const sessions = (sessionsResult.results ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      session_id: String(row.session_id),
      started_at: String(row.started_at),
      duration_ms: Number(row.duration_ms) || 0,
      pageviews: Number(row.pageviews) || 0,
      clicks: Number(row.clicks) || 0,
      ip: (row.ip as string | null) ?? null,
      country: (row.country as string | null) ?? null,
      region: (row.region as string | null) ?? null,
      city: (row.city as string | null) ?? null,
      tz: (row.tz as string | null) ?? null,
      ua_short: shortUA((row.ua as string | null) ?? null),
    };
  });

  const [pv, dwellAvg, ipCount, ccCount] = await Promise.all([
    c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM events WHERE event='pageview' AND ts >= ?",
    )
      .bind(start)
      .first<{ n: number }>(),
    c.env.DB.prepare(
      "SELECT AVG(dwell_ms) AS n FROM events WHERE event='dwell' AND ts >= ?",
    )
      .bind(start)
      .first<{ n: number }>(),
    c.env.DB.prepare(
      "SELECT COUNT(DISTINCT ip) AS n FROM events WHERE ip IS NOT NULL AND ts >= ?",
    )
      .bind(start)
      .first<{ n: number }>(),
    c.env.DB.prepare(
      "SELECT COUNT(DISTINCT country) AS n FROM events WHERE country IS NOT NULL AND ts >= ?",
    )
      .bind(start)
      .first<{ n: number }>(),
  ]);

  const totalSessionMs = sessions.reduce((acc, s) => acc + s.duration_ms, 0);
  const avgSessionMs = sessions.length
    ? Math.round(totalSessionMs / sessions.length)
    : 0;

  return c.json({
    ok: true,
    data: {
      summary: {
        days,
        sessions: sessions.length,
        pageviews: pv?.n ?? 0,
        uniqueIps: ipCount?.n ?? 0,
        countries: ccCount?.n ?? 0,
        avgSessionMs,
        avgDwellMs: Math.round(Number(dwellAvg?.n) || 0),
      },
      sessions,
    },
  });
});

// ── Single session timeline ─────────────────────────────
admin.get("/audit/session", async (c) => {
  const sid = c.req.query("sid");
  if (!sid) return c.json({ ok: false, error: "missing sid" }, 400);

  const eventsResult = await c.env.DB.prepare(
    `SELECT ts, event, path, detail, dwell_ms
     FROM events
     WHERE session_id = ?
     ORDER BY ts ASC
     LIMIT 1000`,
  )
    .bind(sid)
    .all();

  const metaResult = await c.env.DB.prepare(
    `SELECT
       MIN(ts) AS first_seen,
       MAX(ts) AS last_seen,
       MAX(ip) AS ip,
       MAX(country) AS country,
       MAX(region) AS region,
       MAX(city) AS city,
       MAX(tz) AS tz,
       MAX(ua) AS ua,
       MAX(referrer) AS referrer
     FROM events WHERE session_id = ?`,
  )
    .bind(sid)
    .first<Record<string, unknown>>();

  return c.json({
    ok: true,
    data: {
      meta: metaResult ?? {},
      events: eventsResult.results ?? [],
    },
  });
});

// ── User management (paginated, search, status filter) ─
const ALLOWED_STATUSES = ["active", "paused", "blocked", "banned"] as const;
type UserStatus = (typeof ALLOWED_STATUSES)[number];

admin.get("/users", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const status = c.req.query("status");
  const limit = Math.max(1, Math.min(200, Number(c.req.query("limit")) || 50));
  const offset = Math.max(0, Number(c.req.query("offset")) || 0);

  const where: string[] = [];
  const binds: unknown[] = [];
  if (q) {
    where.push("(email LIKE ? OR name LIKE ? OR id = ?)");
    const like = `%${q}%`;
    binds.push(like, like, q);
  }
  if (status && (ALLOWED_STATUSES as readonly string[]).includes(status)) {
    where.push("COALESCE(status,'active') = ?");
    binds.push(status);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [rows, total, counts] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, email, name, provider, email_consent,
              COALESCE(status,'active') AS status, status_reason, status_changed_at,
              last_login_at, last_login_ip, last_login_country, last_login_city,
              COALESCE(login_count,0) AS login_count, created_at
       FROM users ${whereSql}
       ORDER BY (last_login_at IS NULL), last_login_at DESC, created_at DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(...binds, limit, offset)
      .all(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM users ${whereSql}`)
      .bind(...binds)
      .first<{ n: number }>(),
    c.env.DB.prepare(
      `SELECT COALESCE(status,'active') AS status, COUNT(*) AS n FROM users GROUP BY COALESCE(status,'active')`,
    ).all(),
  ]);

  const statusCounts: Record<string, number> = {
    active: 0,
    paused: 0,
    blocked: 0,
    banned: 0,
  };
  for (const r of counts.results ?? []) {
    const row = r as Record<string, unknown>;
    statusCounts[String(row.status)] = Number(row.n);
  }

  return c.json({
    ok: true,
    data: {
      total: total?.n ?? 0,
      limit,
      offset,
      statusCounts,
      users: rows.results ?? [],
    },
  });
});

admin.get("/users/:id", async (c) => {
  const id = c.req.param("id");

  const user = await c.env.DB.prepare(
    `SELECT id, email, name, provider, email_consent,
            COALESCE(status,'active') AS status, status_reason, status_changed_at, status_changed_by,
            last_login_at, last_login_ip, last_login_country, last_login_city,
            COALESCE(login_count,0) AS login_count, created_at
     FROM users WHERE id = ?`,
  )
    .bind(id)
    .first<Record<string, unknown>>();

  if (!user) return c.json({ ok: false, error: "not_found" }, 404);

  const [logins, sessions, totals, adminLog] = await Promise.all([
    // Last 10 logins from canonical audit log
    c.env.DB.prepare(
      `SELECT ts, ip, country, city, ua
       FROM events WHERE user_id = ? AND event = 'login'
       ORDER BY ts DESC LIMIT 10`,
    )
      .bind(id)
      .all(),
    // Recent sessions for this user (last 20)
    c.env.DB.prepare(
      `SELECT session_id,
              MIN(ts) AS started_at,
              MAX(ts) AS last_ts,
              (julianday(MAX(ts)) - julianday(MIN(ts))) * 86400000 AS duration_ms,
              SUM(CASE WHEN event='pageview' THEN 1 ELSE 0 END) AS pageviews,
              MAX(ip) AS ip, MAX(country) AS country, MAX(city) AS city
       FROM events WHERE user_id = ?
       GROUP BY session_id ORDER BY MIN(ts) DESC LIMIT 20`,
    )
      .bind(id)
      .all(),
    // Lifetime totals
    c.env.DB.prepare(
      `SELECT
         COUNT(DISTINCT session_id) AS sessions,
         SUM(CASE WHEN event='pageview' THEN 1 ELSE 0 END) AS pageviews,
         SUM(CASE WHEN event='click' THEN 1 ELSE 0 END) AS clicks,
         SUM(CASE WHEN event='dwell' THEN COALESCE(dwell_ms,0) ELSE 0 END) AS total_dwell_ms
       FROM events WHERE user_id = ?`,
    )
      .bind(id)
      .first<Record<string, unknown>>(),
    // Recent admin actions targeting this user
    c.env.DB.prepare(
      `SELECT ts, actor_email, action, detail FROM admin_actions
       WHERE target_user = ? ORDER BY ts DESC LIMIT 20`,
    )
      .bind(id)
      .all(),
  ]);

  return c.json({
    ok: true,
    data: {
      user,
      logins: logins.results ?? [],
      sessions: sessions.results ?? [],
      totals: totals ?? {},
      adminLog: adminLog.results ?? [],
    },
  });
});

admin.post("/users/:id/status", async (c) => {
  const id = c.req.param("id");
  const body: unknown = await c.req.json().catch(() => null);
  if (typeof body !== "object" || body === null) {
    return c.json({ ok: false, error: "bad_request" }, 400);
  }
  const b = body as Record<string, unknown>;
  const status = String(b.status ?? "");
  const reason = typeof b.reason === "string" ? b.reason.slice(0, 256) : null;

  if (!(ALLOWED_STATUSES as readonly string[]).includes(status)) {
    return c.json({ ok: false, error: "invalid_status" }, 400);
  }

  const now = new Date().toISOString();
  const actor = (c.req.header("Cf-Access-Authenticated-User-Email") ??
    c.req.header("CF-Access-Authenticated-User-Email") ??
    "admin") as string;
  const actorIp = c.req.header("CF-Connecting-IP") ?? null;

  const res = await c.env.DB.prepare(
    `UPDATE users SET status = ?, status_reason = ?, status_changed_at = ?, status_changed_by = ?
     WHERE id = ?`,
  )
    .bind(status as UserStatus, reason, now, actor, id)
    .run();

  if (!res.success) {
    return c.json({ ok: false, error: "update_failed" }, 500);
  }

  await c.env.DB.prepare(
    `INSERT INTO admin_actions (actor_id, actor_email, action, target_user, detail, ip)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(null, actor, `status:${status}`, id, reason, actorIp)
    .run();

  return c.json({ ok: true });
});

export default admin;
