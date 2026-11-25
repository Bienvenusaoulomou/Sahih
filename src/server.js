// Sahih — web server + API
const path = require("path");
const express = require("express");
const QRCode = require("qrcode");
const h = require("./hedera");
const reg = require("./registry");
const engine = require("./engine");
const secure = require("./secure");
const accounts = require("./accounts");
const billing = require("./billing");

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "200kb" }));
app.use((req, res, next) => { // basic security headers
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  next();
});
app.use(express.static(path.join(__dirname, "..", "public")));
const PORT = process.env.PORT || 3000;
const COOKIE = "sahih_session";
const baseUrl = (req) => process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
const fail = (msg, status) => Object.assign(new Error(msg), { status });
const wrap = (fn) => async (req, res) => {
  try { res.json(await fn(req, res)); }
  catch (e) { if (!e.status || e.status >= 500) console.error(e); res.status(e.status || 500).json({ error: e.message || String(e) }); }
};
const publicInst = ({ id, name, kind, aliases, account, topicId, channels, status, accreditedAt, revokedAt, revokeReason, registrySequence }) =>
  ({ id, name, kind, aliases, account, topicId, channels, status, accreditedAt, revokedAt, revokeReason, registrySequence });

// ------------------------------------------------------------ sessions
function readCookie(req) {
  const raw = req.headers.cookie || "";
  const m = raw.split(/;\s*/).find((c) => c.startsWith(COOKIE + "="));
  return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : null;
}
app.use((req, res, next) => { req.session = secure.verifyToken(readCookie(req)); next(); });
function setSession(req, res, user) {
  const token = secure.signToken({ uid: user.id, role: user.role, instId: user.instId || null, email: user.email });
  const secureFlag = req.secure || (baseUrl(req).startsWith("https") ? "; Secure" : "");
  res.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${8 * 3600}${secureFlag ? "; Secure" : ""}`);
}
const needAuthority = (req) => { if (!req.session || req.session.role !== "authority") throw fail("Accès réservé à l'autorité de confiance. Connectez-vous.", 401); };
const needInstitution = (req, id) => {
  if (!req.session) throw fail("Connectez-vous pour accéder à cet espace.", 401);
  if (req.session.role === "institution" && req.session.instId === id) return;
  throw fail("Vous n'avez pas accès à cette institution.", 403);
};

app.post("/api/auth/login", wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const key = `${req.ip}|${String(email || "").toLowerCase()}`;
  if (secure.rateLimited(key)) throw fail("Trop de tentatives. Réessayez dans 10 minutes.", 429);
  const user = accounts.login(email, password);
  if (!user) throw fail("E-mail ou mot de passe incorrect.", 401);
  setSession(req, res, user);
  return { user: accounts.publicUser(user), redirect: user.role === "authority" ? "/authority.html" : "/institution.html" };
}));
app.post("/api/auth/logout", wrap(async (req, res) => {
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  return { ok: true };
}));
app.get("/api/me", wrap(async (req) => {
  if (!req.session) return { user: null };
  const inst = req.session.instId ? reg.store.institutions().find((i) => i.id === req.session.instId) : null;
  return { user: { email: req.session.email, role: req.session.role, instId: req.session.instId }, institution: inst ? publicInst(inst) : null };
}));
app.post("/api/auth/password", wrap(async (req) => {
  if (!req.session) throw fail("Connectez-vous.", 401);
  return accounts.changePassword(req.session.uid, (req.body || {}).current, (req.body || {}).next);
}));

// ------------------------------------------------------------ state (public)
app.get("/api/state", wrap(async () => {
  const cfg = reg.store.config();
  const reports = reg.store.reports();
  return {
    ready: !!cfg, network: h.NETWORK, hashscan: h.HASHSCAN,
    config: cfg && { registryTopicId: cfg.registryTopicId, reportsTopicId: cfg.reportsTopicId, authorityAccount: cfg.authorityAccount, authorityName: cfg.authorityName },
    ai: !!process.env.GEMINI_API_KEY,
    bot: process.env.TELEGRAM_BOT_USERNAME || (process.env.TELEGRAM_BOT_TOKEN ? "actif" : null),
    institutions: reg.store.institutions().map(publicInst),
    stats: {
      publications: reg.store.publications().length, reports: reports.length,
      institutions: reg.store.institutions().filter((i) => i.status === "ACCREDITED").length,
      verifications: Object.values(h.read("stats.json", { total: {} }).total || {}).reduce((a, b) => a + b, 0),
    },
  };
}));

// ------------------------------------------------------------ citizens (no account)
app.post("/api/verify", wrap(async (req) => engine.analyze(req.body || {}, { ai: false }))); // Hedera verdict, instant
app.get("/api/explain/:id", wrap(async (req) => (await engine.explain(req.params.id)) || { error: "expired" })); // AI explanation
app.get("/api/code/:code", wrap(async (req) => engine.byCode(req.params.code) || { verdict: "NOT_FOUND" }));
app.post("/api/report", wrap(async (req) => {
  if (secure.rateLimited(`report|${req.ip}`, 20, 10 * 60 * 1000)) throw fail("Trop de signalements depuis cette connexion. Réessayez plus tard.", 429);
  const { text, verdict, claimedId, hosts, aiDigest } = req.body || {};
  return reg.report({ text, verdict, claimedId, domains: hosts, aiDigest });
}));
app.post("/api/applications", wrap(async (req) => {
  if (secure.rateLimited(`apply|${req.ip}`, 5, 60 * 60 * 1000)) throw fail("Trop de demandes depuis cette connexion.", 429);
  return accounts.apply(req.body || {});
}));

// ------------------------------------------------------------ authority (login required)
app.get("/api/authority/overview", wrap(async (req) => {
  needAuthority(req);
  return {
    applications: accounts.applications(),
    institutions: reg.store.institutions().map((i) => ({ ...publicInst(i), access: accounts.accessFor(i.id) })),
    stats: h.read("stats.json", { total: {}, byInst: {}, daily: {} }),
    reports: reg.store.reports().slice(0, 30),
  };
}));
app.post("/api/applications/:id/approve", wrap(async (req) => { needAuthority(req); const r = await accounts.approve(req.params.id); return { ...r, institution: publicInst(r.institution) }; }));
app.post("/api/applications/:id/reject", wrap(async (req) => { needAuthority(req); return accounts.reject(req.params.id, (req.body || {}).reason); }));
app.post("/api/institutions", wrap(async (req) => { needAuthority(req); return publicInst(await reg.accredit(req.body || {})); }));
app.post("/api/institutions/:id/revoke", wrap(async (req) => { needAuthority(req); return publicInst(await reg.revokeAccreditation(req.params.id, (req.body || {}).reason)); }));
app.post("/api/institutions/:id/access", wrap(async (req) => { needAuthority(req); return accounts.createAccess(req.params.id, (req.body || {}).email); }));

// ------------------------------------------------------------ institution space (login required, own institution only)
app.get("/api/institutions/:id", wrap(async (req) => {
  needInstitution(req, req.params.id);
  const inst = reg.store.institutions().find((i) => i.id === req.params.id);
  if (!inst) throw fail("Institution inconnue.", 404);
  return {
    institution: publicInst(inst),
    publications: reg.store.publications().filter((p) => p.instId === inst.id),
    alerts: reg.store.reports().filter((r) => r.claimed === inst.id),
    stats: (h.read("stats.json", { byInst: {} }).byInst || {})[inst.id] || { verdicts: {}, daily: {} },
  };
}));
app.post("/api/institutions/:id/publish", wrap(async (req) => {
  needInstitution(req, req.params.id);
  billing.assertCanPublish(req.params.id); // subscription + quota
  const pub = await reg.publish(req.params.id, req.body || {});
  const url = `${baseUrl(req)}/?code=${pub.code}`;
  return { publication: pub, url, qr: await QRCode.toDataURL(url, { margin: 1, width: 300 }) };
}));
app.post("/api/institutions/:id/channels", wrap(async (req) => {
  needInstitution(req, req.params.id);
  return publicInst((await reg.updateChannels(req.params.id, req.body || {})).inst);
}));
app.get("/api/qr/:code", wrap(async (req) => {
  const url = `${baseUrl(req)}/?code=${encodeURIComponent(req.params.code)}`;
  return { url, qr: await QRCode.toDataURL(url, { margin: 1, width: 300 }) };
}));

// ------------------------------------------------------------ billing (citizens: always free)
app.get("/api/billing/plans", wrap(async () => ({ plans: Object.values(billing.PLANS), trial: billing.TRIAL, tva: billing.TVA, timbre: billing.TIMBRE })));
app.get("/api/billing/me", wrap(async (req) => {
  if (!req.session || req.session.role !== "institution") throw fail("Connectez-vous.", 401);
  const id = req.session.instId;
  const q = billing.quotaInfo(id);
  return { ...q, plans: Object.values(billing.PLANS), trial: billing.TRIAL, invoices: billing.forInst(id), month: billing.monthKey() };
}));
app.post("/api/billing/subscribe", wrap(async (req) => {
  if (!req.session || req.session.role !== "institution") throw fail("Connectez-vous.", 401);
  return billing.subscribe(req.session.instId, (req.body || {}).plan);
}));
app.post("/api/billing/invoices/:id/declare", wrap(async (req) => {
  if (!req.session || req.session.role !== "institution") throw fail("Connectez-vous.", 401);
  return billing.declarePayment(req.session.instId, req.params.id, req.body || {});
}));
app.get("/api/billing/invoices/:id/pdf", async (req, res) => {
  try {
    const inv = billing.invoices().find((i) => i.id === req.params.id);
    if (!inv) throw fail("Facture introuvable.", 404);
    if (!req.session) throw fail("Connectez-vous.", 401);
    if (!(req.session.role === "authority" || (req.session.role === "institution" && req.session.instId === inv.instId))) throw fail("Accès refusé.", 403);
    const buf = await billing.pdf(inv, baseUrl(req));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Facture-${inv.number}.pdf"`);
    res.end(buf);
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});
app.get("/api/billing/all", wrap(async (req) => {
  needAuthority(req);
  const insts = reg.store.institutions();
  return {
    summary: billing.summary(),
    invoices: billing.invoices().map((i) => ({ ...i, instName: (insts.find((x) => x.id === i.instId) || {}).name || i.instId })),
    subscriptions: insts.map((i) => ({ id: i.id, name: i.name, ...billing.quotaInfo(i.id) })),
  };
}));
app.post("/api/billing/invoices/:id/confirm", wrap(async (req) => { needAuthority(req); return billing.confirmPayment(req.params.id, req.body || {}); }));
app.get("/api/billing/verify/:number", wrap(async (req) => billing.verify(req.params.number, req.query.h)));

// ------------------------------------------------------------ public activity (local index of Hedera)
app.get("/api/feed", wrap(async () => {
  const insts = reg.store.institutions();
  const name = (id) => (insts.find((i) => i.id === id) || {}).name || id;
  const items = [
    ...insts.map((i) => ({ type: "ACCREDIT", at: i.accreditedAt, title: `${i.name} accréditée`, topicId: reg.store.config()?.registryTopicId })),
    ...insts.filter((i) => i.status === "REVOKED").map((i) => ({ type: "REVOKE", at: i.revokedAt, title: `Accréditation de ${i.name} révoquée` })),
    ...reg.store.publications().map((p) => ({ type: "PUBLISH", at: p.at, title: `${name(p.instId)} · ${p.title || p.kind}`, code: p.code, topicId: p.topicId, private: p.private })),
    ...reg.store.reports().map((r) => ({ type: "REPORT", at: r.at, title: `Signalement${r.claimed ? ` : faux message au nom de ${name(r.claimed)}` : ""}`, topicId: reg.store.config()?.reportsTopicId })),
  ].filter((x) => x.at).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40);
  return items;
}));
app.post("/api/sync", wrap(async (req) => { needAuthority(req); return reg.syncFromHedera(); }));

app.listen(PORT, async () => {
  const cfg = reg.store.config();
  console.log(`\nSahih running → http://localhost:${PORT}`);
  if (!cfg) return console.log("⚠ Not set up yet: run `npm run setup`");
  console.log(`Trust registry ${cfg.registryTopicId} · Reports ${cfg.reportsTopicId} (${h.NETWORK})`);
  const migrated = reg.encryptLegacyKeys();
  if (migrated) console.log(`Encrypted ${migrated} institution key(s) at rest`);
  const auth = accounts.ensureAuthority();
  if (auth) {
    console.log("\n┌──────────────────────────────────────────────────────────┐");
    console.log("│  Compte AUTORITÉ créé — notez ces identifiants :          │");
    console.log(`│  E-mail       : ${auth.email.padEnd(41)}│`);
    console.log(`│  Mot de passe : ${auth.password.padEnd(41)}│`);
    console.log("│  (affiché une seule fois — connexion sur /login.html)     │");
    console.log("└──────────────────────────────────────────────────────────┘\n");
  }
  console.log(`AI: ${process.env.GEMINI_API_KEY ? "Gemini enabled" : "rules only (add GEMINI_API_KEY to .env)"}`);
  try { const s = await reg.syncFromHedera(); console.log(`Index rebuilt from Hedera: ${s.institutions} institutions, ${s.publications} publications`); }
  catch (e) { console.warn("Sync from mirror node skipped:", e.message); }
  try { const n = await billing.runRenewals(); if (n) console.log(`Billing: ${n} monthly invoice(s) issued`); } catch (e) { console.warn("Billing renewals:", e.message); }
  setInterval(() => billing.runRenewals().catch((e) => console.warn("Billing renewals:", e.message)), 3600 * 1000);
  if (process.env.TELEGRAM_BOT_TOKEN) require("./bot").start();
});
