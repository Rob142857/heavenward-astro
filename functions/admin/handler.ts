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

function refHost(ref: string | null): string {
  if (!ref) return "(direct)";
  try {
    const u = new URL(ref);
    return u.hostname || "(direct)";
  } catch {
    return ref.slice(0, 60);
  }
}

// ── Dashboard HTML ──────────────────────────────────────
admin.get("/", async (c) => {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const weekAgo = new Date(now.getTime() - 7 * 86400000)
    .toISOString()
    .slice(0, 10);

  const [
    totalUsers,
    usersToday,
    totalEvents,
    eventsToday,
    sessionsToday,
    sessions7d,
    topPages,
    topClicks,
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
body{background:#0a0e1a;color:#e0e6f0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;margin:0;min-height:100dvh}
.wrap{max-width:1280px;margin:0 auto;padding:20px 24px 48px}
h1{font-size:1.5rem;color:#f5e6a3;margin-bottom:6px}
.sub{color:#7b869c;font-size:.78rem;margin-bottom:18px}
h2{font-size:.95rem;color:#d4af37;margin:24px 0 10px;text-transform:uppercase;letter-spacing:.1em;font-weight:500}
h2.sub-h{font-size:.78rem;margin:16px 0 8px;letter-spacing:.08em}

/* Tabs */
.tabs{position:sticky;top:0;background:#0a0e1a;display:flex;gap:4px;border-bottom:1px solid #1e2a42;margin-bottom:18px;padding:8px 0 0;flex-wrap:wrap;z-index:10}
.tab{background:transparent;color:#7b869c;border:none;border-bottom:2px solid transparent;padding:10px 16px;font-size:.85rem;font-weight:600;cursor:pointer;letter-spacing:.02em}
.tab:hover{color:#e0e6f0}
.tab.active{color:#f5e6a3;border-bottom-color:#d4af37}
.tab .badge{display:inline-block;background:#1a2236;color:#7b869c;border-radius:10px;padding:1px 8px;font-size:.65rem;margin-left:6px;font-weight:600}
.section{display:none}
.section.active{display:block}

.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:18px}
.stat{background:#111827;border:1px solid #1e2a42;border-radius:12px;padding:14px;text-align:center}
.stat .n{font-size:1.7rem;font-weight:700;color:#f5e6a3}
.stat .l{font-size:.7rem;color:#7b869c;margin-top:4px;text-transform:uppercase;letter-spacing:.05em}

table{width:100%;border-collapse:collapse;background:#111827;border:1px solid #1e2a42;border-radius:12px;overflow:hidden;margin-bottom:12px;font-size:.83rem}
th{background:#1a2236;text-align:left;padding:9px 12px;color:#7b869c;font-weight:600;font-size:.7rem;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap}
td{padding:7px 12px;border-top:1px solid #1e2a42;color:#e0e6f0;vertical-align:middle}
tr:hover td{background:rgba(212,175,55,.04)}
.scroll-x{overflow-x:auto;border-radius:12px}
.muted{color:#7b869c}
.mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.72rem}

.chart{background:#111827;border:1px solid #1e2a42;border-radius:12px;padding:14px;margin-bottom:14px}
.bars{display:flex;align-items:flex-end;gap:4px;height:110px}
.bar-col{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px}
.bar{background:linear-gradient(to top,#b8942e,#f5e6a3);border-radius:3px 3px 0 0;min-width:10px;width:100%}
.bar-label{font-size:.58rem;color:#7b869c;writing-mode:vertical-lr;transform:rotate(180deg)}
.bar-n{font-size:.62rem;color:#f5e6a3}

.btn{display:inline-flex;align-items:center;justify-content:center;padding:8px 14px;border-radius:8px;border:1px solid transparent;font-size:.8rem;font-weight:600;cursor:pointer;background:#d4af37;color:#0a0e1a;line-height:1}
.btn:hover{background:#f5e6a3}
.btn.ghost{background:#1a2236;color:#e0e6f0;border-color:#1e2a42}
.btn.ghost:hover{border-color:#d4af37;color:#f5e6a3;background:#1a2236}
.btn.sm{padding:5px 10px;font-size:.7rem}
.btn[disabled]{opacity:.4;cursor:not-allowed}
.st-btn-paused{background:#f5e6a3}
.st-btn-blocked{background:#ffa726}
.st-btn-banned{background:#ef5350;color:#fff}

input,select,textarea{background:#111827;border:1px solid #1e2a42;border-radius:8px;color:#e0e6f0;padding:8px 12px;font-size:.85rem;font-family:inherit}
input:focus,select:focus,textarea:focus{outline:none;border-color:#d4af37}
textarea{width:100%;min-height:140px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.78rem}

.controls{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:center}
.controls .grow{flex:1;min-width:220px}

.status-badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:.66rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap}
.st-active{background:rgba(102,187,106,.15);color:#66bb6a;border:1px solid rgba(102,187,106,.3)}
.st-paused{background:rgba(245,230,163,.15);color:#f5e6a3;border:1px solid rgba(245,230,163,.3)}
.st-blocked{background:rgba(255,167,38,.15);color:#ffa726;border:1px solid rgba(255,167,38,.3)}
.st-banned{background:rgba(239,83,80,.15);color:#ef5350;border:1px solid rgba(239,83,80,.3)}

.rangebtn{background:#1a2236;color:#e0e6f0;border:1px solid #1e2a42;padding:6px 12px;border-radius:8px;font-size:.75rem;cursor:pointer;margin-left:4px}
.rangebtn.active{background:#d4af37;color:#0a0e1a;border-color:#d4af37;font-weight:600}
.rangebtn:hover{border-color:#d4af37}

#audit-sessions tr[data-sid]:hover td,#users-table tr[data-uid]:hover td{background:rgba(212,175,55,.08);cursor:pointer}
.row-actions{display:flex;gap:4px;justify-content:flex-end}

.panel{background:#111827;border:1px solid #1e2a42;border-radius:12px;padding:14px;margin-bottom:12px}
.kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;font-size:.8rem}
.kv > div span.k{color:#7b869c}

.copy-success{color:#66bb6a;font-size:.72rem;margin-left:8px}
.notice{font-size:.75rem;color:#7b869c;margin:4px 0 10px}

.pager{display:flex;gap:10px;align-items:center;justify-content:center;margin-top:8px;font-size:.78rem;color:#7b869c}
.pager .page-info{font-variant-numeric:tabular-nums}

.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1a2236;color:#f5e6a3;border:1px solid #d4af37;border-radius:10px;padding:10px 18px;font-size:.82rem;z-index:100;opacity:0;transition:opacity .2s}
.toast.show{opacity:1}
</style></head><body>
<div class="wrap">
<h1>✦ Heavenward Admin</h1>
<div class="sub">Operations console · ${esc(totalUsers?.n?.toLocaleString() ?? "0")} users · ${esc(totalEvents?.n?.toLocaleString() ?? "0")} events tracked</div>

<div class="stats">
  <div class="stat"><div class="n">${totalUsers?.n ?? 0}</div><div class="l">Total Users</div></div>
  <div class="stat"><div class="n">${usersToday?.n ?? 0}</div><div class="l">New Today</div></div>
  <div class="stat"><div class="n">${sessionsToday?.n ?? 0}</div><div class="l">Sessions Today</div></div>
  <div class="stat"><div class="n">${sessions7d?.n ?? 0}</div><div class="l">Sessions 7d</div></div>
  <div class="stat"><div class="n">${eventsToday?.n ?? 0}</div><div class="l">Events Today</div></div>
  <div class="stat"><div class="n">${totalEvents?.n ?? 0}</div><div class="l">Total Events</div></div>
</div>

<div class="tabs" role="tablist">
  <button class="tab active" data-tab="overview">Overview</button>
  <button class="tab" data-tab="users">Users <span class="badge" id="tab-users-badge">${totalUsers?.n ?? 0}</span></button>
  <button class="tab" data-tab="audit">Audit Log</button>
  <button class="tab" data-tab="export">Email &amp; Export</button>
</div>

<!-- ── Overview ── -->
<section class="section active" data-section="overview">
  <div class="controls" style="margin-bottom:8px">
    <h2 style="margin:0;flex:1">Traffic</h2>
    <label class="muted" style="font-size:.75rem">Bucket:</label>
    <select id="ts-bucket">
      <option value="hour">Hourly (last 48h)</option>
      <option value="day" selected>Daily (last 30d)</option>
      <option value="week">Weekly (last 12w)</option>
    </select>
    <label class="muted" style="font-size:.75rem;margin-left:6px">Metric:</label>
    <select id="ts-metric">
      <option value="pageviews" selected>Page views</option>
      <option value="sessions">Sessions</option>
      <option value="uniques">Unique IPs</option>
    </select>
  </div>
  <div class="chart"><div class="bars" id="ts-chart"><span class="muted">Loading…</span></div></div>

  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px">
    <div>
      <h2>Top Pages (7d)</h2>
      <div class="scroll-x"><table><tr><th>Path</th><th>Views</th></tr>${tableRows(topPages.results ?? [])}</table></div>
    </div>
    <div>
      <h2>Top Object Clicks (7d)</h2>
      <div class="scroll-x"><table><tr><th>Object</th><th>Clicks</th></tr>${tableRows(topClicks.results ?? [])}</table></div>
    </div>
  </div>
</section>

<!-- ── Users ── -->
<section class="section" data-section="users">
  <div class="controls">
    <input id="user-search" class="grow" placeholder="Search email, name, or user id…">
    <select id="user-status">
      <option value="">All statuses</option>
      <option value="active">Active</option>
      <option value="paused">Paused</option>
      <option value="blocked">Blocked</option>
      <option value="banned">Banned</option>
    </select>
    <select id="user-pagesize">
      <option value="50" selected>50 / page</option>
      <option value="100">100 / page</option>
      <option value="500">500 / page</option>
      <option value="all">All</option>
    </select>
    <button class="btn ghost" id="user-search-btn">Search</button>
    <button class="btn ghost" id="user-export-btn">Export filtered…</button>
  </div>
  <div class="notice" id="user-counts">Loading…</div>
  <div class="scroll-x" id="users-table"></div>
  <div class="pager" id="users-pager"></div>
  <div id="user-detail" style="display:none;margin-top:18px"></div>
</section>

<!-- ── Audit Log ── -->
<section class="section" data-section="audit">
  <div class="controls" style="justify-content:flex-end">
    <span class="muted" style="margin-right:auto">Rolling window:</span>
    <button class="rangebtn active" data-days="7">7d</button>
    <button class="rangebtn" data-days="30">30d</button>
  </div>
  <div id="audit-summary" class="stats"></div>
  <div id="audit-insights" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin-bottom:14px"></div>
  <h2 class="sub-h" style="margin-top:0">Recent Sessions</h2>
  <div class="scroll-x" id="audit-sessions"></div>
  <div id="audit-detail" style="display:none;margin-top:16px"></div>
</section>

<!-- ── Email & Export ── -->
<section class="section" data-section="export">
  <h2>Bulk Email — All Users with Consent</h2>
  <p class="notice">Exports all users who granted email consent. Paste into your email client's BCC field.</p>
  <div class="controls">
    <select id="exp-format">
      <option value="comma">Emails — comma separated (Gmail)</option>
      <option value="semicolon">Emails — semicolon separated (Outlook)</option>
      <option value="newline">Emails — one per line</option>
      <option value="rfc">"Name &lt;email&gt;" — comma separated</option>
      <option value="csv">CSV (id, email, name, status, last_login, country)</option>
    </select>
    <select id="exp-scope">
      <option value="consent">With email consent</option>
      <option value="all">All users</option>
      <option value="active">Active only</option>
    </select>
    <button class="btn" id="exp-go">Generate</button>
    <button class="btn ghost" id="exp-copy" disabled>Copy</button>
    <button class="btn ghost" id="exp-download" disabled>Download</button>
    <span class="copy-success" id="exp-status"></span>
  </div>
  <textarea id="exp-out" readonly placeholder="Output will appear here…"></textarea>
  <p class="notice">Tip: For very large lists, use <strong>Download</strong> rather than the clipboard.</p>

  <h2>Export the Currently Filtered User List</h2>
  <p class="notice">Use the <em>Users</em> tab's "Export filtered…" button to apply the active search/status filters to the export.</p>
</section>

</div>

<div class="toast" id="toast"></div>

<script>
// ── Helpers ──
function esc(s){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
function fmtDur(ms){if(!ms||ms<0)return"—";const s=Math.round(ms/1000);if(s<60)return s+"s";const m=Math.floor(s/60),rs=s%60;if(m<60)return m+"m "+rs+"s";const h=Math.floor(m/60);return h+"h "+(m%60)+"m";}
function toast(msg){const t=document.getElementById("toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),1800);}
async function copyText(text){try{await navigator.clipboard.writeText(text);toast("Copied ✓");}catch(e){toast("Copy failed");}}

// ── Tabs ──
document.querySelectorAll(".tab").forEach(function(btn){
  btn.addEventListener("click",function(){
    const id=btn.dataset.tab;
    document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("active",t===btn));
    document.querySelectorAll(".section").forEach(s=>s.classList.toggle("active",s.dataset.section===id));
    location.hash="#"+id;
    if(id==="users"&&!usersLoaded){loadUsers(true);usersLoaded=true;}
    if(id==="audit"&&!auditLoaded){loadAudit(7);auditLoaded=true;}
  });
});
// Restore tab from hash
(function(){const h=location.hash.replace("#","");if(h){const b=document.querySelector('.tab[data-tab="'+h+'"]');if(b)b.click();}})();

// ── Overview chart ──
async function loadChart(){
  const bucket=document.getElementById("ts-bucket").value;
  const metric=document.getElementById("ts-metric").value;
  const el=document.getElementById("ts-chart");
  el.innerHTML='<span class="muted">Loading…</span>';
  const r=await fetch("/admin/timeseries?bucket="+bucket);
  const d=await r.json();
  if(!d.ok){el.textContent="Error: "+d.error;return;}
  const pts=d.data.points;
  if(!pts.length){el.innerHTML='<span class="muted">No data in range.</span>';return;}
  const max=Math.max.apply(null,pts.map(function(p){return p[metric];}));
  el.innerHTML=pts.map(function(p){
    const pct=max>0?(p[metric]/max)*100:0;
    const tip=p.label+" · "+p.pageviews+" pv · "+p.sessions+" sess · "+p.uniques+" IPs";
    return '<div class="bar-col" title="'+esc(tip)+'"><div class="bar-n">'+p[metric]+'</div><div class="bar" style="height:'+pct+'%"></div><div class="bar-label">'+esc(p.label)+'</div></div>';
  }).join("");
}
document.getElementById("ts-bucket").addEventListener("change",loadChart);
document.getElementById("ts-metric").addEventListener("change",loadChart);
loadChart();

// ── Users ──
let usersLoaded=false, userOffset=0, userPageSize=50, lastUsersResp=null;
async function loadUsers(reset){
  if(reset)userOffset=0;
  const q=document.getElementById("user-search").value.trim();
  const st=document.getElementById("user-status").value;
  const sz=document.getElementById("user-pagesize").value;
  userPageSize=sz==="all"?5000:Number(sz);
  const params=new URLSearchParams({limit:String(userPageSize),offset:String(userOffset)});
  if(q)params.set("q",q);
  if(st)params.set("status",st);
  const r=await fetch("/admin/users?"+params.toString());
  const d=await r.json();
  if(!d.ok){document.getElementById("users-table").textContent="Error: "+d.error;return;}
  lastUsersResp=d.data;
  const sc=d.data.statusCounts;
  document.getElementById("user-counts").innerHTML=
    "<strong>"+d.data.total.toLocaleString()+"</strong> matches · "+
    '<span class="status-badge st-active">'+sc.active+" active</span> "+
    '<span class="status-badge st-paused">'+sc.paused+" paused</span> "+
    '<span class="status-badge st-blocked">'+sc.blocked+" blocked</span> "+
    '<span class="status-badge st-banned">'+sc.banned+" banned</span>";
  const rows=d.data.users.map(function(u){
    const loc=[u.last_login_city,u.last_login_country].filter(Boolean).join(", ")||"—";
    const last=u.last_login_at?u.last_login_at.replace("T"," ").slice(0,16):"never";
    return '<tr data-uid="'+esc(u.id)+'">'+
      '<td>'+esc(u.email)+'</td>'+
      '<td>'+esc(u.name)+'</td>'+
      '<td>'+esc(u.provider)+'</td>'+
      '<td><span class="status-badge st-'+u.status+'">'+u.status+'</span></td>'+
      '<td style="text-align:right">'+(u.login_count||0)+'</td>'+
      '<td>'+esc(last)+'</td>'+
      '<td>'+esc(loc)+'</td>'+
      '<td class="mono">'+esc(u.last_login_ip||"—")+'</td>'+
      '<td class="row-actions">'+
        '<a class="btn ghost sm" href="mailto:'+esc(u.email)+'" onclick="event.stopPropagation()" title="Email user">✉</a>'+
        '<button class="btn ghost sm" onclick="event.stopPropagation();copyText(\\''+esc(u.email).replace(/'/g,"\\\\'")+'\\')" title="Copy email">⎘</button>'+
      '</td>'+
    '</tr>';
  }).join("");
  document.getElementById("users-table").innerHTML=
    '<table><tr><th>Email</th><th>Name</th><th>Provider</th><th>Status</th><th>Logins</th><th>Last Login</th><th>Location</th><th>Last IP</th><th></th></tr>'+rows+'</table>';
  document.querySelectorAll("#users-table tr[data-uid]").forEach(function(tr){
    tr.addEventListener("click",function(){loadUserDetail(tr.dataset.uid);});
  });
  const total=d.data.total;
  const page=Math.floor(userOffset/userPageSize)+1;
  const pages=Math.max(1,Math.ceil(total/userPageSize));
  document.getElementById("users-pager").innerHTML=
    '<button class="btn ghost sm" '+(userOffset===0?"disabled":"")+' id="prev-pg">← Prev</button>'+
    '<span class="page-info">Page '+page+' / '+pages+' · showing '+d.data.users.length+' of '+total.toLocaleString()+'</span>'+
    '<button class="btn ghost sm" '+(userOffset+userPageSize>=total?"disabled":"")+' id="next-pg">Next →</button>';
  const prev=document.getElementById("prev-pg");
  const next=document.getElementById("next-pg");
  if(prev)prev.addEventListener("click",function(){userOffset=Math.max(0,userOffset-userPageSize);loadUsers(false);});
  if(next)next.addEventListener("click",function(){userOffset+=userPageSize;loadUsers(false);});
}
async function loadUserDetail(uid){
  const r=await fetch("/admin/users/"+encodeURIComponent(uid));
  const d=await r.json();
  const el=document.getElementById("user-detail");
  el.style.display="block";
  if(!d.ok){el.textContent="Error: "+d.error;return;}
  const u=d.data.user,t=d.data.totals;
  const loginRows=d.data.logins.map(function(l){
    return '<tr><td>'+esc((l.ts||"").replace("T"," ").slice(0,19))+'</td>'+
      '<td class="mono">'+esc(l.ip||"—")+'</td>'+
      '<td>'+esc([l.city,l.country].filter(Boolean).join(", ")||"—")+'</td>'+
      '<td class="mono">'+esc((l.ua||"").slice(0,60))+'</td></tr>';
  }).join("")||'<tr><td colspan="4" class="muted">No login events recorded.</td></tr>';
  const sessRows=d.data.sessions.map(function(s){
    return '<tr><td class="mono">'+esc(s.session_id.slice(0,8))+'</td>'+
      '<td>'+esc((s.started_at||"").replace("T"," ").slice(0,16))+'</td>'+
      '<td>'+fmtDur(s.duration_ms||0)+'</td>'+
      '<td style="text-align:right">'+(s.pageviews||0)+'</td>'+
      '<td>'+esc([s.city,s.country].filter(Boolean).join(", ")||"—")+'</td>'+
      '<td class="mono">'+esc(s.ip||"—")+'</td></tr>';
  }).join("")||'<tr><td colspan="6" class="muted">No sessions recorded.</td></tr>';
  const adminRows=d.data.adminLog.map(function(a){
    return '<tr><td>'+esc((a.ts||"").replace("T"," ").slice(0,19))+'</td>'+
      '<td>'+esc(a.actor_email||"—")+'</td>'+
      '<td>'+esc(a.action)+'</td>'+
      '<td>'+esc(a.detail||"")+'</td></tr>';
  }).join("")||'<tr><td colspan="4" class="muted">No admin actions on this account.</td></tr>';
  el.innerHTML=
    '<h2 style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">'+esc(u.email)+
      ' <span class="status-badge st-'+u.status+'">'+u.status+'</span>'+
      '<span style="margin-left:auto;display:flex;gap:6px">'+
        '<a class="btn sm" href="mailto:'+esc(u.email)+'">Email user</a>'+
        '<button class="btn ghost sm" onclick="copyText(\\''+esc(u.email).replace(/'/g,"\\\\'")+'\\')">Copy email</button>'+
        '<button class="btn ghost sm" onclick="document.getElementById(\\'user-detail\\').style.display=\\'none\\'">Close</button>'+
      '</span>'+
    '</h2>'+
    '<div class="panel kv">'+
      '<div><span class="k">User ID:</span> <span class="mono">'+esc(u.id)+'</span></div>'+
      '<div><span class="k">Name:</span> '+esc(u.name)+'</div>'+
      '<div><span class="k">Provider:</span> '+esc(u.provider)+'</div>'+
      '<div><span class="k">Created:</span> '+esc((u.created_at||"").slice(0,19).replace("T"," "))+'</div>'+
      '<div><span class="k">Last login:</span> '+esc((u.last_login_at||"never").replace("T"," ").slice(0,19))+'</div>'+
      '<div><span class="k">Login count:</span> '+(u.login_count||0)+'</div>'+
      '<div><span class="k">Last IP:</span> <span class="mono">'+esc(u.last_login_ip||"—")+'</span></div>'+
      '<div><span class="k">Last location:</span> '+esc([u.last_login_city,u.last_login_country].filter(Boolean).join(", ")||"—")+'</div>'+
      '<div><span class="k">Sessions:</span> '+(t.sessions||0)+'</div>'+
      '<div><span class="k">Pageviews:</span> '+(t.pageviews||0)+'</div>'+
      '<div><span class="k">Clicks:</span> '+(t.clicks||0)+'</div>'+
      '<div><span class="k">Total dwell:</span> '+fmtDur(t.total_dwell_ms||0)+'</div>'+
      (u.status_reason?'<div style="grid-column:1/-1;color:#f5e6a3"><span class="k">Status reason:</span> '+esc(u.status_reason)+' <span class="k">by</span> '+esc(u.status_changed_by||"")+' '+esc((u.status_changed_at||"").replace("T"," ").slice(0,16))+'</div>':"")+
    '</div>'+
    '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">'+
      ['active','paused','blocked','banned'].map(function(s){
        return '<button class="btn statbtn st-btn-'+s+' sm" data-status="'+s+'" '+(u.status===s?'disabled':'')+'>'+
          (s==='active'?'Reinstate':s.charAt(0).toUpperCase()+s.slice(1))+'</button>';
      }).join("")+
    '</div>'+
    '<h2 class="sub-h">Last 10 Logins</h2>'+
    '<div class="scroll-x"><table><tr><th>Time</th><th>IP</th><th>Location</th><th>User-Agent</th></tr>'+loginRows+'</table></div>'+
    '<h2 class="sub-h">Recent Sessions</h2>'+
    '<div class="scroll-x"><table><tr><th>Session</th><th>Started</th><th>Duration</th><th>Views</th><th>Location</th><th>IP</th></tr>'+sessRows+'</table></div>'+
    '<h2 class="sub-h">Admin Actions</h2>'+
    '<div class="scroll-x"><table><tr><th>Time</th><th>Actor</th><th>Action</th><th>Reason</th></tr>'+adminRows+'</table></div>';
  el.querySelectorAll(".statbtn").forEach(function(b){
    b.addEventListener("click",function(){updateStatus(uid,b.dataset.status);});
  });
  el.scrollIntoView({behavior:"smooth",block:"start"});
}
async function updateStatus(uid,status){
  const reason=prompt((status==="active"?"Reinstatement note":"Reason for "+status)+" (optional):","")||"";
  const r=await fetch("/admin/users/"+encodeURIComponent(uid)+"/status",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({status:status,reason:reason})
  });
  const d=await r.json();
  if(!d.ok){alert("Failed: "+d.error);return;}
  toast("Status updated → "+status);
  await loadUserDetail(uid);
  await loadUsers(false);
}
document.getElementById("user-search-btn").addEventListener("click",function(){loadUsers(true);});
document.getElementById("user-search").addEventListener("keydown",function(e){if(e.key==="Enter")loadUsers(true);});
document.getElementById("user-status").addEventListener("change",function(){loadUsers(true);});
document.getElementById("user-pagesize").addEventListener("change",function(){loadUsers(true);});

// Filtered export (uses current search/status)
document.getElementById("user-export-btn").addEventListener("click",async function(){
  const q=document.getElementById("user-search").value.trim();
  const st=document.getElementById("user-status").value;
  const format=prompt("Format: comma | semicolon | newline | rfc | csv","comma")||"comma";
  const params=new URLSearchParams({format:format});
  if(q)params.set("q",q);
  if(st)params.set("status",st);
  const r=await fetch("/admin/users/export?"+params.toString());
  if(!r.ok){alert("Export failed");return;}
  const text=await r.text();
  document.querySelector('.tab[data-tab="export"]').click();
  document.getElementById("exp-out").value=text;
  document.getElementById("exp-status").textContent=text.split(/\\r?\\n/).filter(Boolean).length+" rows from current filter";
  document.getElementById("exp-copy").disabled=false;
  document.getElementById("exp-download").disabled=false;
});

// ── Audit ──
let auditLoaded=false;
function listPanel(title,items,labelKey){
  const total=items.reduce(function(a,b){return a+b.n;},0)||1;
  const rows=items.slice(0,10).map(function(it){
    const pct=Math.round((it.n/total)*100);
    return '<tr><td>'+esc(it[labelKey]||"—")+'</td><td style="text-align:right">'+it.n+'</td><td style="text-align:right;color:#7b869c">'+pct+'%</td></tr>';
  }).join("")||'<tr><td colspan="3" class="muted">No data.</td></tr>';
  return '<div class="panel"><h2 class="sub-h" style="margin-top:0">'+title+'</h2><table><tr><th>'+labelKey.charAt(0).toUpperCase()+labelKey.slice(1)+'</th><th style="text-align:right">Sessions</th><th style="text-align:right">%</th></tr>'+rows+'</table></div>';
}
async function loadAudit(days){
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
  document.getElementById("audit-insights").innerHTML=
    listPanel("Top Referrers",d.data.referrers||[],"host")+
    listPanel("Browsers",d.data.browsers||[],"label")+
    listPanel("Countries",d.data.topCountries||[],"country")+
    listPanel("Cities",d.data.topCities||[],"label");
  const rows=d.data.sessions.map(function(x){
    const loc=[x.city,x.region,x.country].filter(Boolean).join(", ")||"—";
    return '<tr data-sid="'+esc(x.session_id)+'">'+
      '<td class="mono">'+esc(x.session_id.slice(0,8))+'</td>'+
      '<td>'+esc(x.started_at.replace("T"," ").slice(0,16))+'</td>'+
      '<td>'+fmtDur(x.duration_ms)+'</td>'+
      '<td style="text-align:right">'+x.pageviews+'</td>'+
      '<td style="text-align:right">'+x.clicks+'</td>'+
      '<td>'+esc(loc)+'</td>'+
      '<td class="mono">'+esc(x.ip||"—")+'</td>'+
      '<td>'+esc(x.ua_short||"—")+'</td>'+
      '<td title="'+esc(x.referrer||"")+'">'+esc(x.ref_host||"(direct)")+'</td>'+
    '</tr>';
  }).join("");
  document.getElementById("audit-sessions").innerHTML=
    '<table><tr><th>Session</th><th>Started</th><th>Duration</th><th>Views</th><th>Clicks</th><th>Location</th><th>IP</th><th>Client</th><th>Referrer</th></tr>'+rows+'</table>'+
    '<p class="notice">Click any row for the full navigation timeline.</p>';
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
    return '<tr><td class="mono">'+esc(e.ts.replace("T"," ").slice(0,19))+'</td>'+
      '<td>'+esc(e.event)+'</td>'+
      '<td>'+esc(e.path)+'</td>'+
      '<td>'+esc(e.detail||"")+'</td>'+
      '<td style="text-align:right">'+(e.dwell_ms?fmtDur(e.dwell_ms):"—")+'</td></tr>';
  }).join("");
  const loc=[meta.city,meta.region,meta.country].filter(Boolean).join(", ")||"—";
  el.innerHTML='<h2 style="display:flex;align-items:center;gap:12px">Session '+esc(sid.slice(0,8))+
      ' <button class="btn ghost sm" style="margin-left:auto" onclick="document.getElementById(\\'audit-detail\\').style.display=\\'none\\'">Close</button>'+
    '</h2>'+
    '<div class="panel kv">'+
      '<div><span class="k">IP:</span> <span class="mono">'+esc(meta.ip||"—")+'</span></div>'+
      '<div><span class="k">Location:</span> '+esc(loc)+'</div>'+
      '<div><span class="k">Timezone:</span> '+esc(meta.tz||"—")+'</div>'+
      '<div><span class="k">Referrer:</span> '+esc(meta.referrer||"—")+'</div>'+
      '<div><span class="k">First seen:</span> '+esc((meta.first_seen||"").replace("T"," ").slice(0,19))+'</div>'+
      '<div><span class="k">Last seen:</span> '+esc((meta.last_seen||"").replace("T"," ").slice(0,19))+'</div>'+
      '<div style="grid-column:1/-1"><span class="k">User-Agent:</span> <span class="mono">'+esc(meta.ua||"—")+'</span></div>'+
    '</div>'+
    '<div class="scroll-x"><table><tr><th>Time</th><th>Event</th><th>Path</th><th>Detail</th><th>Dwell</th></tr>'+rows+'</table></div>';
  el.scrollIntoView({behavior:"smooth",block:"start"});
}
document.querySelectorAll(".rangebtn").forEach(function(b){
  b.addEventListener("click",function(){loadAudit(Number(b.dataset.days));});
});

// ── Export ──
document.getElementById("exp-go").addEventListener("click",async function(){
  const format=document.getElementById("exp-format").value;
  const scope=document.getElementById("exp-scope").value;
  const params=new URLSearchParams({format:format});
  if(scope==="consent")params.set("consent","1");
  if(scope==="active")params.set("status","active");
  const r=await fetch("/admin/users/export?"+params.toString());
  if(!r.ok){alert("Export failed");return;}
  const text=await r.text();
  const out=document.getElementById("exp-out");
  out.value=text;
  const lines=text.split(/\\r?\\n/).filter(Boolean).length;
  document.getElementById("exp-status").textContent=lines.toLocaleString()+" rows generated";
  document.getElementById("exp-copy").disabled=false;
  document.getElementById("exp-download").disabled=false;
});
document.getElementById("exp-copy").addEventListener("click",function(){copyText(document.getElementById("exp-out").value);});
document.getElementById("exp-download").addEventListener("click",function(){
  const text=document.getElementById("exp-out").value;
  const format=document.getElementById("exp-format").value;
  const ext=format==="csv"?"csv":"txt";
  const blob=new Blob([text],{type:format==="csv"?"text/csv":"text/plain"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;a.download="heavenward-users-"+new Date().toISOString().slice(0,10)+"."+ext;
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
});
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
// ── Time-series for Overview chart ──────────────────────
admin.get("/timeseries", async (c) => {
  const bucket = c.req.query("bucket") ?? "day";
  let groupExpr: string;
  let labelExpr: string;
  let start: string;
  let buckets: number;

  if (bucket === "hour") {
    // Last 48 hours by hour
    groupExpr = "strftime('%Y-%m-%d %H', ts)";
    labelExpr = "strftime('%m-%d %Hh', ts)";
    start = new Date(Date.now() - 48 * 3600000)
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
    buckets = 48;
  } else if (bucket === "week") {
    // Last 12 ISO weeks
    groupExpr = "strftime('%Y-%W', ts)";
    labelExpr = "strftime('%Y-W%W', ts)";
    start = new Date(Date.now() - 84 * 86400000)
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
    buckets = 12;
  } else {
    // Last 30 days by day
    groupExpr = "strftime('%Y-%m-%d', ts)";
    labelExpr = "strftime('%m-%d', ts)";
    start = new Date(Date.now() - 30 * 86400000)
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
    buckets = 30;
  }

  const result = await c.env.DB.prepare(
    `SELECT ${groupExpr} AS bucket,
            ${labelExpr} AS label,
            COUNT(*) AS pageviews,
            COUNT(DISTINCT session_id) AS sessions,
            COUNT(DISTINCT ip) AS uniques
     FROM events
     WHERE event='pageview' AND ts >= ?
     GROUP BY bucket
     ORDER BY bucket`,
  )
    .bind(start)
    .all();

  return c.json({
    ok: true,
    data: {
      bucket,
      buckets,
      points: (result.results ?? []).map((r) => {
        const row = r as Record<string, unknown>;
        return {
          label: String(row.label ?? ""),
          pageviews: Number(row.pageviews) || 0,
          sessions: Number(row.sessions) || 0,
          uniques: Number(row.uniques) || 0,
        };
      }),
    },
  });
});

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
       MAX(ua) AS ua,
       MAX(referrer) AS referrer
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
      referrer: (row.referrer as string | null) ?? null,
      ref_host: refHost((row.referrer as string | null) ?? null),
    };
  });

  const [pv, dwellAvg, ipCount, ccCount, topRef, topCountry, topCity, topBrowser] = await Promise.all([
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
    // Top referrers by unique session count
    c.env.DB.prepare(
      `SELECT referrer, COUNT(DISTINCT session_id) AS n
       FROM events WHERE ts >= ? AND referrer IS NOT NULL AND referrer != ''
       GROUP BY referrer ORDER BY n DESC LIMIT 15`,
    )
      .bind(start)
      .all(),
    c.env.DB.prepare(
      `SELECT country, COUNT(DISTINCT session_id) AS n
       FROM events WHERE ts >= ? AND country IS NOT NULL
       GROUP BY country ORDER BY n DESC LIMIT 15`,
    )
      .bind(start)
      .all(),
    c.env.DB.prepare(
      `SELECT country, city, COUNT(DISTINCT session_id) AS n
       FROM events WHERE ts >= ? AND city IS NOT NULL
       GROUP BY country, city ORDER BY n DESC LIMIT 15`,
    )
      .bind(start)
      .all(),
    c.env.DB.prepare(
      `SELECT ua, COUNT(DISTINCT session_id) AS n
       FROM events WHERE ts >= ? AND ua IS NOT NULL
       GROUP BY ua ORDER BY n DESC LIMIT 50`,
    )
      .bind(start)
      .all(),
  ]);

  // Roll up referrer rows by hostname
  const refMap = new Map<string, number>();
  for (const r of (topRef.results ?? []) as Array<Record<string, unknown>>) {
    const host = refHost(String(r.referrer));
    refMap.set(host, (refMap.get(host) ?? 0) + (Number(r.n) || 0));
  }
  const referrers = [...refMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([host, n]) => ({ host, n }));

  // Roll up browsers by shortUA label
  const brMap = new Map<string, number>();
  for (const r of (topBrowser.results ?? []) as Array<Record<string, unknown>>) {
    const label = shortUA(String(r.ua ?? ""));
    brMap.set(label, (brMap.get(label) ?? 0) + (Number(r.n) || 0));
  }
  const browsers = [...brMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([label, n]) => ({ label, n }));

  const countries = ((topCountry.results ?? []) as Array<Record<string, unknown>>).map((r) => ({
    country: String(r.country),
    n: Number(r.n) || 0,
  }));
  const cities = ((topCity.results ?? []) as Array<Record<string, unknown>>).map((r) => ({
    label: [r.city, r.country].filter(Boolean).join(", "),
    n: Number(r.n) || 0,
  }));

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
      referrers,
      browsers,
      topCountries: countries,
      topCities: cities,
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
  const limit = Math.max(1, Math.min(5000, Number(c.req.query("limit")) || 50));
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

// ── User export (filtered, paste-friendly formats) ──────
admin.get("/users/export", async (c) => {
  const format = c.req.query("format") ?? "comma";
  const q = (c.req.query("q") ?? "").trim();
  const status = c.req.query("status");
  const consentOnly = c.req.query("consent") === "1";
  const cap = Math.min(100000, Number(c.req.query("limit")) || 100000);

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
  if (consentOnly) {
    where.push("email_consent = 1");
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const result = await c.env.DB.prepare(
    `SELECT id, email, name, COALESCE(status,'active') AS status,
            last_login_at, last_login_country
     FROM users ${whereSql}
     ORDER BY created_at DESC
     LIMIT ?`,
  )
    .bind(...binds, cap)
    .all();

  const rows = (result.results ?? []) as Array<Record<string, unknown>>;
  const emails = rows.map((r) => String(r.email ?? "")).filter(Boolean);

  let body: string;
  let contentType = "text/plain; charset=utf-8";
  switch (format) {
    case "semicolon":
      body = emails.join("; ");
      break;
    case "newline":
      body = emails.join("\n");
      break;
    case "rfc":
      body = rows
        .map((r) => {
          const name = String(r.name ?? "").replace(/"/g, "'");
          const email = String(r.email ?? "");
          if (!email) return "";
          return name ? `"${name}" <${email}>` : email;
        })
        .filter(Boolean)
        .join(", ");
      break;
    case "csv": {
      contentType = "text/csv; charset=utf-8";
      const escCsv = (v: unknown) => {
        const s = String(v ?? "");
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const header = "id,email,name,status,last_login_at,country";
      const lines = rows.map((r) =>
        [r.id, r.email, r.name, r.status, r.last_login_at, r.last_login_country]
          .map(escCsv)
          .join(","),
      );
      body = [header, ...lines].join("\n");
      break;
    }
    case "comma":
    default:
      body = emails.join(", ");
      break;
  }

  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
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
