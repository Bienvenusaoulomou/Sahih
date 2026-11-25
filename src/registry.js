// Sahih — on-chain registry logic
//  • Trust registry topic (HCS, submit key = authority): who is who (ACCREDIT / REVOKE)
//  • One topic per institution (HCS, submit key = institution): PUBLISH / CHANNELS, each signed
//  • Reports topic (HCS): anonymous citizen reports of impersonation
const {
  AccountCreateTransaction,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  Hbar,
} = require("@hashgraph/sdk");
const h = require("./hedera");
const secure = require("./secure");

const MAX_MSG = 1000; // keep each HCS message in a single chunk

const store = {
  config: () => h.read("config.json", null),
  institutions: () => h.read("institutions.json", []),
  publications: () => h.read("publications.json", []),
  reports: () => h.read("reports.json", []),
  keys: () => h.read("keys.json", {}),
  users: () => h.read("users.json", []),
  applications: () => h.read("applications.json", []),
};
const save = {
  config: (v) => h.write("config.json", v),
  institutions: (v) => h.write("institutions.json", v),
  publications: (v) => h.write("publications.json", v),
  reports: (v) => h.write("reports.json", v),
  keys: (v) => h.write("keys.json", v),
  users: (v) => h.write("users.json", v),
  applications: (v) => h.write("applications.json", v),
};

const slug = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40);
const list = (v) => (Array.isArray(v) ? v : String(v || "").split(/[,\n]/))
  .map((x) => String(x).trim()).filter(Boolean);
const cleanDomain = (d) => d.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
const cleanPhone = (p) => String(p).replace(/[^\d+]/g, "");
// Social accounts are stored as "platform/handle-path", e.g. "facebook.com/banquedemo", "wa.me/21671111111"
const SOCIAL_ALIASES = { "fb.com": "facebook.com", "m.facebook.com": "facebook.com", "web.facebook.com": "facebook.com", "twitter.com": "x.com", "mobile.twitter.com": "x.com", "telegram.me": "t.me", "youtu.be": "youtube.com", "m.youtube.com": "youtube.com", "vm.tiktok.com": "tiktok.com", "api.whatsapp.com": "wa.me", "fr.linkedin.com": "linkedin.com", "tn.linkedin.com": "linkedin.com" };
const SOCIAL_HOSTS = ["facebook.com", "instagram.com", "tiktok.com", "linkedin.com", "x.com", "youtube.com", "t.me", "wa.me", "whatsapp.com", "chat.whatsapp.com", "threads.net", "snapchat.com"];
function cleanSocial(v) {
  let s = String(v || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[?#]/)[0].replace(/\/+$/, "");
  const [host, ...rest] = s.split("/");
  const h2 = SOCIAL_ALIASES[host] || host;
  let path = rest.filter(Boolean);
  if (h2 === "linkedin.com" || h2 === "whatsapp.com" || (h2 === "youtube.com" && path[0] && !path[0].startsWith("@"))) path = path.slice(0, 2); else path = path.slice(0, 1);
  if (h2 === "wa.me") path = path.map((x) => x.replace(/\D/g, ""));
  return path.length ? `${h2}/${path.join("/")}` : h2;
}

async function submit(topicId, payload, signerKey) {
  const client = h.getClient();
  const msg = JSON.stringify(payload);
  if (Buffer.byteLength(msg) > MAX_MSG) throw new Error("Message too large for a single HCS chunk");
  let tx = new TopicMessageSubmitTransaction().setTopicId(topicId).setMessage(msg);
  if (signerKey) tx = await tx.freezeWith(client).sign(signerKey);
  const resp = await tx.execute(client);
  const rx = await resp.getReceipt(client);
  return { sequence: Number(rx.topicSequenceNumber.toString()), tx: resp.transactionId.toString() };
}

function requireConfig() {
  const c = store.config();
  if (!c) throw new Error("Not set up yet. Run `npm run setup` first.");
  return c;
}

// ---------------------------------------------------------------- authority: accredit an institution
async function accredit({ name, aliases, domains, senders, phones, social, kind }) {
  const cfg = requireConfig();
  if (!name) throw new Error("name is required");
  const client = h.getClient();
  const op = h.getOperator();
  const id = slug(name);
  const all = store.institutions();
  if (all.find((i) => i.id === id && i.status === "ACCREDITED")) throw new Error("Institution already accredited");

  // 1) its own key + Hedera account (its on-chain identity)
  const key = h.PrivateKey.generateECDSA();
  const accResp = await new AccountCreateTransaction()
    .setKeyWithoutAlias(key.publicKey)
    .setInitialBalance(new Hbar(1))
    .setAccountMemo(`Sahih institution: ${name}`.slice(0, 100))
    .execute(client);
  const account = (await accResp.getReceipt(client)).accountId.toString();

  // 2) its own topic: only the institution's key can publish there
  const topicResp = await new TopicCreateTransaction()
    .setTopicMemo(`Sahih official channel: ${name}`.slice(0, 100))
    .setSubmitKey(key.publicKey)
    .setAdminKey(op.key.publicKey)
    .execute(client);
  const topicId = (await topicResp.getReceipt(client)).topicId.toString();

  const channels = {
    domains: list(domains).map(cleanDomain),
    senders: list(senders).map((s) => s.toUpperCase()),
    phones: list(phones).map(cleanPhone),
    social: list(social).map(cleanSocial),
  };
  const inst = {
    id, name, kind: kind || "institution",
    aliases: [...new Set([name, ...list(aliases)].map((a) => h.normalize(a)))],
    account, publicKey: key.publicKey.toStringDer(), topicId, channels,
    status: "ACCREDITED", accreditedAt: new Date().toISOString(),
  };

  // 3) the authority writes it in the trust registry
  const rec = await submit(cfg.registryTopicId, {
    v: 1, type: "ACCREDIT", id, name, kind: inst.kind, aliases: inst.aliases,
    account, publicKey: inst.publicKey, topicId, channels, at: inst.accreditedAt,
  });
  inst.registrySequence = rec.sequence;
  inst.tx = rec.tx;

  const keys = store.keys(); keys[id] = secure.encrypt(key.toStringDer()); save.keys(keys); // encrypted at rest
  save.institutions([...all.filter((i) => i.id !== id), inst]);
  return inst;
}

async function revokeAccreditation(id, reason) {
  const cfg = requireConfig();
  const all = store.institutions();
  const inst = all.find((i) => i.id === id);
  if (!inst) throw new Error("Unknown institution");
  const rec = await submit(cfg.registryTopicId, {
    v: 1, type: "REVOKE", id, reason: reason || "Revoked by authority", at: new Date().toISOString(),
  });
  inst.status = "REVOKED"; inst.revokedAt = new Date().toISOString(); inst.revokeReason = reason;
  save.institutions(all);
  return { ...inst, tx: rec.tx };
}

// ---------------------------------------------------------------- institution: publish / channels
function instKey(id) {
  const stored = store.keys()[id];
  if (!stored) throw new Error("No key for this institution on this server");
  const der = secure.decrypt(stored);
  return h.PrivateKey.fromStringDer(der);
}

async function publish(id, { kind, title, text, isPrivate }) {
  const all = store.institutions();
  const inst = all.find((i) => i.id === id);
  if (!inst || inst.status !== "ACCREDITED") throw new Error("Institution not accredited");
  if (!text || !String(text).trim()) throw new Error("text is required");
  const key = instKey(id);
  const hash = h.fingerprint(text);
  const sig = h.sign(key, hash);
  const code = "SAH-" + hash.slice(0, 6).toUpperCase();
  const at = new Date().toISOString();
  const base = { v: 1, type: "PUBLISH", kind: kind || "communique", title: String(title || "").slice(0, 120), hash, sig, code, at };
  // Public communiqués go on-chain in full (when they fit in one message); private messages: fingerprint only
  let payload = isPrivate ? base : { ...base, text: String(text) };
  if (Buffer.byteLength(JSON.stringify(payload)) > MAX_MSG) payload = base;
  const rec = await submit(inst.topicId, payload, key);
  const pub = {
    id: `${inst.topicId}-${rec.sequence}`, instId: id, kind: base.kind, title: base.title,
    text: isPrivate ? null : String(text), textOnChain: !!payload.text, private: !!isPrivate,
    hash, sig, code, at, topicId: inst.topicId, sequence: rec.sequence, tx: rec.tx,
  };
  save.publications([pub, ...store.publications().filter((p) => p.hash !== hash)]);
  return pub;
}

async function updateChannels(id, { domains, senders, phones, social }) {
  const all = store.institutions();
  const inst = all.find((i) => i.id === id);
  if (!inst || inst.status !== "ACCREDITED") throw new Error("Institution not accredited");
  const channels = {
    domains: list(domains).map(cleanDomain),
    senders: list(senders).map((s) => s.toUpperCase()),
    phones: list(phones).map(cleanPhone),
    social: list(social).map(cleanSocial),
  };
  const body = { v: 1, type: "CHANNELS", channels, at: new Date().toISOString() };
  const hash = h.sha256(JSON.stringify(channels));
  const rec = await submit(inst.topicId, { ...body, hash, sig: h.sign(instKey(id), hash) }, instKey(id));
  inst.channels = channels;
  save.institutions(all);
  return { inst, tx: rec.tx };
}

// ---------------------------------------------------------------- citizens: anonymous reports
async function report({ verdict, claimedId, text, domains, aiDigest }) {
  const cfg = requireConfig();
  const at = new Date().toISOString();
  const payload = {
    v: 1, type: "REPORT", verdict, claimed: claimedId || null,
    textHash: h.fingerprint(text || ""), domains: (domains || []).slice(0, 5), ai: aiDigest || null, at,
  };
  const rec = await submit(cfg.reportsTopicId, payload);
  const r = { ...payload, excerpt: String(text || "").slice(0, 280), sequence: rec.sequence, tx: rec.tx };
  save.reports([r, ...store.reports()].slice(0, 500));
  return r;
}

// ---------------------------------------------------------------- rebuild the index from Hedera alone
async function syncFromHedera() {
  const cfg = store.config();
  if (!cfg) return { ok: false };
  const local = store.institutions();
  const byId = Object.fromEntries(local.map((i) => [i.id, i]));
  const reg = await h.topicMessages(cfg.registryTopicId, { limit: 100 });
  for (const m of reg) {
    const p = m.payload;
    if (!p) continue;
    if (p.type === "ACCREDIT") {
      byId[p.id] = {
        ...(byId[p.id] || {}), id: p.id, name: p.name, kind: p.kind, aliases: p.aliases, account: p.account,
        publicKey: p.publicKey, topicId: p.topicId, channels: (byId[p.id] && byId[p.id].channels) || p.channels,
        status: "ACCREDITED", accreditedAt: h.tsToIso(m.ts), registrySequence: m.sequence,
      };
    } else if (p.type === "REVOKE" && byId[p.id]) {
      byId[p.id].status = "REVOKED"; byId[p.id].revokedAt = h.tsToIso(m.ts); byId[p.id].revokeReason = p.reason;
    }
  }
  const pubs = store.publications();
  const byHash = Object.fromEntries(pubs.map((p) => [p.hash, p]));
  for (const inst of Object.values(byId)) {
    if (!inst.topicId) continue;
    const msgs = await h.topicMessages(inst.topicId, { limit: 100 });
    for (const m of msgs) {
      const p = m.payload;
      if (!p) continue;
      if (p.type === "CHANNELS" && h.verifySig(inst.publicKey, p.hash, p.sig)) inst.channels = p.channels;
      if (p.type === "PUBLISH" && h.verifySig(inst.publicKey, p.hash, p.sig)) {
        const prev = byHash[p.hash] || {};
        byHash[p.hash] = {
          ...prev, id: `${inst.topicId}-${m.sequence}`, instId: inst.id, kind: p.kind, title: p.title,
          text: p.text || prev.text || null, textOnChain: !!p.text, private: !p.text && !prev.text,
          hash: p.hash, sig: p.sig, code: p.code, at: prev.at || p.at, consensusAt: h.tsToIso(m.ts),
          topicId: inst.topicId, sequence: m.sequence,
        };
      }
    }
  }
  save.institutions(Object.values(byId));
  save.publications(Object.values(byHash).sort((a, b) => String(b.at).localeCompare(String(a.at))));
  return { ok: true, institutions: Object.keys(byId).length, publications: Object.keys(byHash).length };
}

// Encrypt any key still stored in clear (from an older version)
function encryptLegacyKeys() {
  const keys = store.keys();
  let changed = 0;
  for (const k of Object.keys(keys)) if (!String(keys[k]).startsWith("enc:")) { keys[k] = secure.encrypt(keys[k]); changed++; }
  if (changed) save.keys(keys);
  return changed;
}

module.exports = { cleanSocial, SOCIAL_HOSTS, SOCIAL_ALIASES, encryptLegacyKeys, store, save, accredit, revokeAccreditation, publish, updateChannels, report, syncFromHedera, requireConfig };
