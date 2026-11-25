// Shared UI helpers
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status });
  return data;
}
let STATE = null, ME = null;
const spaceUrl = (u) => (u.role === "authority" ? "/authority.html" : "/institution.html");

// Top navigation for the public site and the login page
async function nav(active) {
  const el = document.createElement("div");
  el.className = "nav";
  el.innerHTML = `<div class="in">
    <a class="logo" href="/" aria-label="Sahih, accueil"><img src="/img/logo-mark-light.png" alt="" aria-hidden="true"><b>SAHIH</b><span class="ar" lang="ar">صحيح</span></a>
    <nav class="links" aria-label="Navigation principale">
      <a class="link ${active === "home" ? "on" : ""}" href="/#verifier">Vérifier</a>
      <a class="link" href="/#fonctionnement">Fonctionnement</a>
      <a class="link" href="/#registre">Registre public</a>
      <a class="link" href="/#tarifs">Tarifs</a>
      <a class="link" href="/#telegram">Telegram</a>
    </nav>
    <span class="nav-right" id="navRight"></span></div>`;
  document.body.prepend(el);
  try {
    [STATE, ME] = await Promise.all([api("/api/state"), api("/api/me")]);
    const u = ME.user;
    $("#navRight").innerHTML = u
      ? `<a class="pill" href="${spaceUrl(u)}">${u.role === "authority" ? "Console autorité" : esc(ME.institution ? ME.institution.name : "Mon espace")} <i aria-hidden="true">↗</i></a>`
      : `<a class="pill" href="/login.html">Espace institution <i aria-hidden="true">↗</i></a>`;
  } catch {}
  return STATE;
}

// Sidebar + top bar for the dashboards (institution and authority)
const ICONS = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>',
  building: '<path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1M14 9h1M9 13h1M14 13h1M9 17h1M14 17h1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 6-6"/>',
};
const icon = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ""}</svg>`;
function dashShell({ title, subtitle, groups, plan, user }) {
  document.body.className = "theme-dash";
  document.body.insertAdjacentHTML("afterbegin", `<div class="shell">
    <aside class="side" aria-label="Menu">
      <a class="brand" href="/" style="text-decoration:none"><img src="/img/logo-mark-light.png" alt=""><span><b>Sahih</b><small>${esc(subtitle)}</small></span></a>
      ${groups.map((g) => `<div class="grp">${esc(g.label)}</div>${g.items.map((i) => `<a class="item" href="${i.href}" data-sec="${i.href.slice(1)}">${icon(i.icon)}<span>${esc(i.label)}</span>${i.badge ? `<span class="n" id="${i.badge}"></span>` : ""}</a>`).join("")}`).join("")}
      <div class="plan">${plan}</div>
    </aside>
    <div class="main" id="main">
      <div class="topbar">
        <label class="search" for="q" style="margin:0">${icon("eye")}<input id="q" placeholder="Tester un message comme un citoyen… (Entrée)"></label>
        <a class="iconbtn" href="/" title="Site public">${icon("home")}</a>
        <button class="iconbtn" id="logoutBtn" title="Se déconnecter">${icon("out")}</button>
        <span class="me"><span class="av">${esc((user.label || "?").slice(0, 2).toUpperCase())}</span><span>${esc(user.label)}<small>${esc(user.sub)}</small></span></span>
      </div>
    </div></div>`);
  $("#logoutBtn").onclick = async () => { await api("/api/auth/logout", { method: "POST" }); location.href = "/login.html"; };
  $("#q").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.value.trim()) { sessionStorage.setItem("sahih_try", e.target.value); location.href = "/#verifier"; } });
  const sync = () => document.querySelectorAll(".side a.item").forEach((a) => a.classList.toggle("on", a.getAttribute("href") === (location.hash || groups[0].items[0].href)));
  addEventListener("hashchange", sync); sync();
  return $("#main");
}
async function requireRole(role) {
  try { [STATE, ME] = await Promise.all([api("/api/state"), api("/api/me")]); } catch {}
  if (!ME || !ME.user || ME.user.role !== role) { location.href = "/login.html?next=" + encodeURIComponent(location.pathname); return false; }
  return true;
}
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" }) : "");
const fmtShort = (iso) => (iso ? new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
function last7(daily) { // [{label, value}] for the last 7 days
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5), k = d.toISOString().slice(0, 10);
    out.push({ label: d.toLocaleDateString("fr-FR", { weekday: "short" }).replace(".", ""), value: (daily || {})[k] || 0 });
  }
  return out;
}
function barsHtml(series) {
  const max = Math.max(1, ...series.map((s) => s.value));
  return `<div class="bars">${series.map((s, i) => `<div class="b ${i === series.length - 1 ? "last" : ""}">${s.value ? `<em>${s.value}</em>` : ""}<i style="height:${Math.max(4, (s.value / max) * 100)}%"></i>${esc(s.label)}</div>`).join("")}</div>`;
}
function donutSvg(parts, center, sub) { // parts: [{value,color}]
  const total = parts.reduce((a, p) => a + p.value, 0) || 1, r = 62, c = 2 * Math.PI * r;
  let off = 0;
  const segs = parts.map((p) => { const len = (p.value / total) * c; const s = `<circle r="${r}" cx="80" cy="80" fill="none" stroke="${p.color}" stroke-width="20" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-off}" transform="rotate(-90 80 80)"/>`; off += len; return s; }).join("");
  return `<svg width="170" height="170" viewBox="0 0 160 160" role="img" aria-label="${esc(sub)}"><circle r="${r}" cx="80" cy="80" fill="none" stroke="rgba(15,36,51,.08)" stroke-width="20"/>${segs}
    <text x="80" y="80" text-anchor="middle" font-size="26" font-weight="700" fill="#0f2433">${esc(center)}</text><text x="80" y="100" text-anchor="middle" font-size="11" fill="#557085">${esc(sub)}</text></svg>`;
}

const money = (n) => `${Number(n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} TND`;
const INV_STATUS = { UNPAID: ["À payer", "bad"], DECLARED: ["Paiement déclaré", "mid"], PAID: ["Payée", "ok"], CANCELLED: ["Annulée", "mid"] };
const invBadge = (s) => `<span class="badge ${INV_STATUS[s][1]}">${INV_STATUS[s][0]}</span>`;
const monthName = (k) => new Date(k + "-15").toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
