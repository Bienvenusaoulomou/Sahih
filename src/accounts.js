// Sahih — accounts: authority + institution users, accreditation requests
const crypto = require("crypto");
const reg = require("./registry");
const secure = require("./secure");

const normEmail = (e) => String(e || "").trim().toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const list = (v) => (Array.isArray(v) ? v : String(v || "").split(/[,\n]/)).map((x) => String(x).trim()).filter(Boolean);
const cleanDomain = (d) => d.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });

function emailOnDomain(email, domains) {
  const d = normEmail(email).split("@")[1] || "";
  return (domains || []).some((x) => d === x || d.endsWith("." + x));
}
const publicUser = (u) => u && { id: u.id, email: u.email, role: u.role, instId: u.instId || null, name: u.name || null };

// First start: create the authority account (from .env, or a generated password printed once in the console)
function ensureAuthority() {
  const users = reg.store.users();
  const existing = users.find((u) => u.role === "authority");
  if (existing) {
    // .env is the source of truth: if AUTHORITY_PASSWORD changed, update it (lets you recover the account)
    if (process.env.AUTHORITY_PASSWORD && !secure.verifyPassword(process.env.AUTHORITY_PASSWORD, existing.passwordHash)) {
      existing.passwordHash = secure.hashPassword(process.env.AUTHORITY_PASSWORD);
      if (process.env.AUTHORITY_EMAIL) existing.email = normEmail(process.env.AUTHORITY_EMAIL);
      reg.save.users(users);
    }
    return null;
  }
  const email = normEmail(process.env.AUTHORITY_EMAIL || "autorite@sahih.tn");
  const password = process.env.AUTHORITY_PASSWORD || secure.randomPassword();
  users.push({ id: crypto.randomUUID(), email, passwordHash: secure.hashPassword(password), role: "authority", name: "Autorité de confiance", createdAt: new Date().toISOString() });
  reg.save.users(users);
  return { email, password, generated: !process.env.AUTHORITY_PASSWORD };
}

function login(email, password) {
  const u = reg.store.users().find((x) => x.email === normEmail(email));
  if (!u || u.disabled || !secure.verifyPassword(password, u.passwordHash)) return null;
  if (u.role === "institution") {
    const inst = reg.store.institutions().find((i) => i.id === u.instId);
    if (!inst || inst.status !== "ACCREDITED") throw fail("L'accréditation de cette institution a été révoquée.", 403);
  }
  return u;
}

// ------------------------------------------------------------ public: request accreditation
function apply(body) {
  const name = String(body.name || "").trim();
  const email = normEmail(body.email);
  const domains = list(body.domains).map(cleanDomain);
  if (name.length < 3) throw fail("Indiquez le nom officiel de l'institution.");
  if (!EMAIL_RE.test(email)) throw fail("Adresse e-mail invalide.");
  if (!domains.length) throw fail("Indiquez au moins un domaine officiel (ex. institution.tn).");
  const weak = secure.checkPasswordStrength(body.password);
  if (weak) throw fail(weak);
  if (reg.store.users().some((u) => u.email === email)) throw fail("Un compte existe déjà avec cette adresse.");
  const apps = reg.store.applications();
  if (apps.some((a) => a.email === email && a.status === "PENDING")) throw fail("Une demande est déjà en attente pour cette adresse.");
  const app = {
    id: crypto.randomUUID(), status: "PENDING", createdAt: new Date().toISOString(),
    name, kind: String(body.kind || "").trim(), aliases: list(body.aliases), domains,
    senders: list(body.senders).map((s) => s.toUpperCase()), phones: list(body.phones), social: list(body.social),
    contactName: String(body.contactName || "").trim(), contactRole: String(body.contactRole || "").trim(),
    email, passwordHash: secure.hashPassword(body.password),
    emailOnOfficialDomain: emailOnDomain(email, domains),
  };
  reg.save.applications([app, ...apps]);
  return { id: app.id, status: app.status };
}

// ------------------------------------------------------------ authority decisions
async function approve(appId) {
  const apps = reg.store.applications();
  const app = apps.find((a) => a.id === appId);
  if (!app || app.status !== "PENDING") throw fail("Demande introuvable ou déjà traitée.", 404);
  const inst = await reg.accredit({ name: app.name, kind: app.kind, aliases: app.aliases, domains: app.domains, senders: app.senders, phones: app.phones, social: app.social || [] });
  const users = reg.store.users();
  users.push({ id: crypto.randomUUID(), email: app.email, passwordHash: app.passwordHash, role: "institution", instId: inst.id, name: app.contactName, createdAt: new Date().toISOString() });
  reg.save.users(users);
  app.status = "APPROVED"; app.decidedAt = new Date().toISOString(); app.instId = inst.id;
  reg.save.applications(apps);
  return { application: publicApp(app), institution: inst };
}
function reject(appId, reason) {
  const apps = reg.store.applications();
  const app = apps.find((a) => a.id === appId);
  if (!app || app.status !== "PENDING") throw fail("Demande introuvable ou déjà traitée.", 404);
  app.status = "REJECTED"; app.decidedAt = new Date().toISOString(); app.reason = String(reason || "").slice(0, 300);
  reg.save.applications(apps);
  return publicApp(app);
}
// Give an existing institution (e.g. accredited by setup) a login
function createAccess(instId, email) {
  const inst = reg.store.institutions().find((i) => i.id === instId);
  if (!inst) throw fail("Institution inconnue.", 404);
  email = normEmail(email);
  if (!EMAIL_RE.test(email)) throw fail("Adresse e-mail invalide.");
  const users = reg.store.users();
  if (users.some((u) => u.email === email && u.instId !== instId)) throw fail("Cette adresse est déjà utilisée.");
  const password = secure.randomPassword();
  const existing = users.find((u) => u.instId === instId && u.email === email);
  if (existing) existing.passwordHash = secure.hashPassword(password);
  else users.push({ id: crypto.randomUUID(), email, passwordHash: secure.hashPassword(password), role: "institution", instId, createdAt: new Date().toISOString() });
  reg.save.users(users);
  return { email, password }; // shown once to the authority, never stored in clear
}
function changePassword(userId, current, next) {
  const users = reg.store.users();
  const u = users.find((x) => x.id === userId);
  if (!u || !secure.verifyPassword(current, u.passwordHash)) throw fail("Mot de passe actuel incorrect.", 403);
  const weak = secure.checkPasswordStrength(next);
  if (weak) throw fail(weak);
  u.passwordHash = secure.hashPassword(next);
  reg.save.users(users);
  return { ok: true };
}

const publicApp = ({ passwordHash, ...a }) => a;
const applications = () => reg.store.applications().map(publicApp);
const accessFor = (instId) => reg.store.users().filter((u) => u.instId === instId).map((u) => u.email);

module.exports = { ensureAuthority, login, apply, approve, reject, createAccess, changePassword, applications, accessFor, publicUser };
