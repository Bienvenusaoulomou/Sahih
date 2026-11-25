// Sahih — verification engine
// Hedera decides what is authentic. The AI only explains (it never changes the verdict).
const h = require("./hedera");
const { store, cleanSocial, SOCIAL_HOSTS, SOCIAL_ALIASES } = require("./registry");
const PLATFORM = { "facebook.com": "Facebook", "instagram.com": "Instagram", "tiktok.com": "TikTok", "linkedin.com": "LinkedIn", "x.com": "X (Twitter)", "youtube.com": "YouTube", "t.me": "Telegram", "wa.me": "WhatsApp", "whatsapp.com": "WhatsApp", "chat.whatsapp.com": "WhatsApp", "threads.net": "Threads", "snapchat.com": "Snapchat" };
const canonHost = (host) => SOCIAL_ALIASES[host] || host;
const isSocialHost = (host) => SOCIAL_HOSTS.includes(canonHost(host));
// Which accredited institution owns this social account (declared on Hedera)?
function socialOwner(insts, id) {
  const [host, ...rest] = id.split("/");
  return insts.find((i) => i.status === "ACCREDITED" && ((i.channels.social || []).includes(id) ||
    (host === "wa.me" && rest[0] && (i.channels.phones || []).some((p) => p.replace(/\D/g, "").endsWith(rest[0].slice(-8))))));
}

const URL_RE = /\b((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"']*)?)/gi;
const PHONE_RE = /(?:\+|00)?\d[\d\s.-]{6,}\d/g;
const SHORTENERS = ["bit.ly", "tinyurl.com", "cutt.ly", "t.co", "is.gd", "rb.gy", "shorturl.at", "goo.gl", "ow.ly", "s.id"];
const BAD_TLDS = ["xyz", "top", "click", "info", "online", "site", "live", "icu", "buzz", "shop", "link", "cfd", "sbs", "vip"];
const RULES = [
  { id: "urgency", label: "Urgence artificielle", re: /urgent|imm[ée]diat|dernier (d[ée]lai|avis|rappel)|sous 24|dans les 24|avant minuit|expire|suspendu|bloqu[ée]|d[ée]sactiv|sinon/ },
  { id: "payment", label: "Demande de paiement", re: /payer|paiement|r[ée]gle[zr]|amende|frais de|carte bancaire|virement|recharge/ },
  { id: "credentials", label: "Demande de code ou d'identifiants", re: /code (de )?(confirmation|v[ée]rification|sms|otp|secret)|mot de passe|identifiant|\bcvv\b|\bpin\b|\botp\b/ },
  { id: "bait", label: "Promesse de gain ou de remboursement", re: /gagn|f[ée]licitations|cadeau|offert|remboursement|bonus|prime exceptionnelle/ },
];

const tokens = (t) => h.normalize(t).split(/[^\p{L}\p{N}%.,]+/u).map((x) => x.replace(/[.,]+$/, "")).filter((x) => x.length > 0);
function similarity(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}
function diff(original, candidate) {
  const O = new Set(tokens(original)), C = new Set(tokens(candidate));
  return { removed: [...O].filter((x) => !C.has(x)).slice(0, 12), added: [...C].filter((x) => !O.has(x)).slice(0, 12) };
}
const hostOf = (u) => u.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
const isOfficialHost = (host, domains) => (domains || []).some((d) => host === d || host.endsWith("." + d));
const digits = (p) => p.replace(/[^\d]/g, "");
const isForeign = (p) => { const s = p.replace(/[\s.-]/g, ""); return (s.startsWith("+") && !s.startsWith("+216")) || (s.startsWith("00") && !s.startsWith("00216")); };

function publicInst(i) {
  if (!i) return null;
  return { id: i.id, name: i.name, account: i.account, topicId: i.topicId, status: i.status, channels: i.channels };
}

// The line institutions add when they post ("✔ Message officiel vérifiable sur Sahih : SAH-XXXXXX") is not part of the signed text
const CODE_RE = /SAH-[0-9A-F]{6}/i;
const SIGNATURE_RE = /[✔✓☑]?\s*(?:message officiel\s*)?(?:vérifiable|vérifié|à vérifier|verifiable)?\s*(?:sur|avec)?\s*(?:sahih)?\s*:?\s*(?:https?:\/\/\S*?\?code=)?SAH-[0-9A-F]{6}/gi;
async function analyze({ text, sender }, opts = {}) {
  const withAI = opts.ai !== false;
  text = String(text || "").slice(0, 4000);
  sender = String(sender || "").trim();
  const insts = store.institutions();
  const pubs = store.publications().filter((p) => !p.media); // posters are checked by image, not by text
  const codeFound = (text.match(CODE_RE) || [null])[0];
  const codePub = codeFound ? pubs.find((p) => p.code === codeFound.toUpperCase()) : null;
  if (codeFound) {
    text = text.replace(SIGNATURE_RE, " ").replace(/[ \t]+\n/g, "\n").trim();
    if (!text && codePub && codePub.text) text = codePub.text; // only the code was pasted
  }
  const norm = h.normalize(text);
  const hash = h.fingerprint(text);
  const checks = [];
  const add = (label, ok, detail) => checks.push({ label, ok, detail });

  // --- extraction
  const urls = [...new Set((text.match(URL_RE) || []).filter((u) => /[a-z]/i.test(u.split(".").pop())))];
  const hosts = [...new Set(urls.map(hostOf))];
  const phones = [...new Set((text.match(PHONE_RE) || []).map((p) => p.trim()).filter((p) => digits(p).length >= 8))];
  const socials = urls.filter((u) => isSocialHost(hostOf(u))).map((u) => { const id = cleanSocial(u); return { raw: u, id, platform: PLATFORM[id.split("/")[0]] || id.split("/")[0], owner: socialOwner(insts, id) }; });
  const aliasWords = (i) => (i.aliases || []).flatMap((a) => [a.replace(/[^a-z0-9]/g, ""), ...a.split(" ")]).filter((w) => w.length >= 4).map((w) => w.replace(/[^a-z0-9]/g, ""));
  const claimed = insts.find((i) => (i.channels.senders || []).includes(sender.toUpperCase()) && sender) ||
    insts.find((i) => (i.aliases || []).some((a) => a.length >= 3 && norm.includes(a))) ||
    (socials.find((x) => x.owner) || {}).owner ||
    insts.find((i) => socials.some((x) => aliasWords(i).some((w) => x.id.split("/").slice(1).join("").replace(/[^a-z0-9]/g, "").includes(w)))) || null;

  // --- 1. exact match on Hedera
  const exact = pubs.find((p) => p.hash === hash);
  if (exact) {
    const inst = insts.find((i) => i.id === exact.instId);
    const sigOk = inst && h.verifySig(inst.publicKey, exact.hash, exact.sig);
    add("Empreinte trouvée dans un canal officiel Hedera", true, `${inst ? inst.name : "?"} · topic ${exact.topicId} · message #${exact.sequence}`);
    add("Signature de l'institution valide", !!sigOk, sigOk ? `Clé publique enregistrée dans le registre de confiance` : "Signature invalide");
    add("Institution accréditée", inst && inst.status === "ACCREDITED", inst && inst.status === "ACCREDITED" ? "Présente dans le registre de l'autorité" : "Accréditation révoquée");
    const ok = sigOk && inst && inst.status === "ACCREDITED";
    return finish(withAI, { verdict: ok ? "AUTHENTIC" : "FAKE", institution: publicInst(inst), publication: exact, checks, text, hash, urls, hosts, phones, flags: [] });
  }
  add("Empreinte trouvée dans un canal officiel Hedera", false, "Aucune publication officielle avec ce contenu exact");

  // --- 2. near match = a real message that was altered
  let best = null;
  for (const p of pubs) {
    if (!p.text) continue;
    const s = similarity(p.text, text);
    if (!best || s > best.score) best = { pub: p, score: s };
  }
  const flags = [];
  for (const r of RULES) if (r.re.test(norm)) flags.push({ id: r.id, label: r.label });
  if (hosts.some((x) => SHORTENERS.includes(x))) flags.push({ id: "shortener", label: "Lien raccourci qui cache la vraie adresse" });
  if (hosts.some((x) => BAD_TLDS.includes(x.split(".").pop()))) flags.push({ id: "tld", label: "Extension de domaine souvent utilisée par les arnaques" });
  if (phones.some(isForeign)) flags.push({ id: "foreign", label: "Numéro étranger" });

  if (best && best.score >= 0.5) {
    const inst = insts.find((i) => i.id === best.pub.instId);
    add("Ressemble à une publication officielle", true, `${Math.round(best.score * 100)} % de similarité avec un message de ${inst ? inst.name : "?"}`);
    add("Contenu identique à l'original", false, "Le texte a été modifié");
    return finish(withAI, { verdict: "MODIFIED", institution: publicInst(inst), publication: best.pub, diff: diff(best.pub.text, text), checks, text, hash, urls, hosts, phones, flags });
  }

  // --- 2a. the message carries a Sahih code
  if (codeFound && !codePub) {
    add(`Code ${codeFound.toUpperCase()}`, false, "Ce code n'existe pas : il a été inventé pour faire croire à un message officiel");
    flags.push({ id: "fakecode", label: "Faux code Sahih" });
    return finish(withAI, { verdict: "FAKE", institution: publicInst(claimed), checks, text, hash, urls, hosts, phones, flags });
  }
  if (codePub && codePub.text) {
    const inst = insts.find((i) => i.id === codePub.instId);
    add(`Code ${codePub.code}`, true, `Correspond à une publication de ${inst ? inst.name : "?"}`);
    add("Contenu identique à la publication de ce code", false, "Le texte a été modifié par rapport à la version signée");
    return finish(withAI, { verdict: "MODIFIED", institution: publicInst(inst), publication: codePub, diff: diff(codePub.text, text), checks, text, hash, urls, hosts, phones, flags });
  }

  // --- 2b. the citizen pasted only a link / account: is it an official channel?
  const rest = urls.reduce((t, u) => t.split(u).join(" "), text).replace(/[\s\p{P}]+/gu, " ").trim();
  if (urls.length && rest.length < 25) {
    const owners = urls.map((u) => {
      const host = hostOf(u);
      if (isSocialHost(host)) { const x = socials.find((s) => s.raw === u); return x && x.owner ? { inst: x.owner, what: `Compte ${x.platform} ${x.id}` } : null; }
      const inst = insts.find((i) => i.status === "ACCREDITED" && isOfficialHost(host, i.channels.domains));
      return inst ? { inst, what: `Site ${host}` } : null;
    });
    if (owners.every(Boolean) && owners.every((o) => o.inst.id === owners[0].inst.id)) {
      checks.length = 0; // a link is not a message: only the channel checks matter
      for (const o of owners) add(o.what, true, `Canal officiel de ${o.inst.name}, déclaré sur Hedera`);
      return finish(withAI, { verdict: "OFFICIAL_CHANNEL", institution: publicInst(owners[0].inst), checks, text, hash, urls, hosts, phones, flags });
    }
  }

  // --- 3. channels of the institution it claims to be
  let channelViolation = false;
  if (claimed) {
    add("Institution citée", true, claimed.name);
    for (const x of socials) {
      const ok = (claimed.channels.social || []).includes(x.id) || (x.owner && x.owner.id === claimed.id);
      if (!ok) channelViolation = true;
      add(`Compte ${x.platform} ${x.id}`, ok, ok ? "Compte officiel déclaré sur Hedera" : `N'est PAS un compte ${x.platform} officiel de ${claimed.name}`);
      if (!ok && aliasWords(claimed).some((w) => x.id.split("/").slice(1).join("").replace(/[^a-z0-9]/g, "").includes(w)))
        flags.push({ id: "fakeaccount", label: `Faux compte ${x.platform} qui imite ${claimed.name}` });
    }
    for (const host of hosts) {
      if (isSocialHost(host)) continue; // handled above, account by account
      const ok = isOfficialHost(host, claimed.channels.domains);
      if (!ok) channelViolation = true;
      add(`Lien ${host}`, ok, ok ? "Domaine officiel déclaré sur Hedera" : `N'est PAS un domaine officiel de ${claimed.name}`);
      const words = (claimed.aliases || []).flatMap((a) => a.split(" ")).filter((w) => w.length >= 4);
      if (!ok && words.some((w) => host.replace(/[^a-z0-9]/g, "").includes(w.replace(/[^a-z0-9]/g, ""))))
        flags.push({ id: "lookalike", label: `Domaine qui imite ${claimed.name}` });
    }
    for (const p of phones) {
      const ok = (claimed.channels.phones || []).some((o) => digits(o).endsWith(digits(p).slice(-8)));
      if (!ok) channelViolation = true;
      add(`Numéro ${p}`, ok, ok ? "Numéro officiel déclaré" : `N'est PAS un numéro officiel de ${claimed.name}`);
    }
    if (sender) {
      const ok = (claimed.channels.senders || []).includes(sender.toUpperCase()) ||
        (claimed.channels.phones || []).some((o) => digits(o) && digits(o).endsWith(digits(sender).slice(-8)));
      if (!ok) channelViolation = true;
      add(`Expéditeur ${sender}`, ok, ok ? "Expéditeur officiel déclaré" : `N'est PAS un expéditeur officiel de ${claimed.name}`);
    }
    add(`Publié par ${claimed.name} sur Hedera`, false, "Cette institution n'a jamais publié ce message");
  }

  let verdict;
  if (claimed && (channelViolation || flags.length)) verdict = "FAKE";
  else if (claimed) verdict = "NOT_OFFICIAL";
  else verdict = flags.length >= 2 ? "SUSPICIOUS" : "UNKNOWN";
  return finish(withAI, { verdict, institution: publicInst(claimed), checks, text, hash, urls, hosts, phones, flags });
}

// --------------------------------------------------------------- AI explanation (Gemini), with rule-based fallback
const VERDICT_FR = {
  AUTHENTIC: "Authentique", OFFICIAL_CHANNEL: "Canal officiel", MODIFIED: "Version modifiée d'un message officiel", FAKE: "Faux / usurpation",
  NOT_OFFICIAL: "Non publié par l'institution citée", SUSPICIOUS: "Suspect", UNKNOWN: "Non vérifiable",
};
function ruleExplanation(r) {
  const who = r.institution ? r.institution.name : "aucune institution identifiée";
  const lines = {
    AUTHENTIC: `Ce message a été publié et signé par ${who} sur Hedera. Il est authentique.`,
    OFFICIAL_CHANNEL: `Ce lien ou ce compte est un canal officiel de ${who}, déclaré sur Hedera. Cela ne garantit pas chaque message publié dessus : vérifiez aussi le message lui-même.`,
    MODIFIED: `Ce message reprend un vrai message de ${who}, mais il a été modifié${r.diff && r.diff.added.length ? ` (ajouté : « ${r.diff.added.slice(0, 4).join(" ")} »)` : ""}. Fiez-vous à la version officielle.`,
    FAKE: `Ce message se présente comme venant de ${who}, mais il utilise des liens, numéros ou expéditeurs que ${who} n'a jamais déclarés. C'est très probablement une arnaque.`,
    NOT_OFFICIAL: `${who} n'a jamais publié ce message. Vérifiez auprès de ses canaux officiels avant d'agir.`,
    SUSPICIOUS: "Ce message n'est lié à aucune institution vérifiée et présente plusieurs signaux d'arnaque.",
    UNKNOWN: "Aucune institution vérifiée n'a publié ce message. Restez prudent.",
  }[r.verdict];
  const advice = r.verdict === "OFFICIAL_CHANNEL" ? ["Abonnez-vous plutôt à ce compte qu'à des copies.", "Méfiez-vous des comptes au nom proche mais différent.", "En cas de doute sur un message, collez-le dans Sahih."] : r.verdict === "AUTHENTIC" ? ["Vous pouvez suivre les instructions du message."] :
    ["Ne cliquez sur aucun lien et ne payez rien.", "Ne communiquez jamais de code reçu par SMS.", "Signalez le message pour alerter l'institution."];
  return { source: "rules", explanation: lines, advice };
}
// Gemini model names change over time: try the configured one, then current fallbacks, and remember what works
const MODELS = [...new Set([process.env.GEMINI_MODEL, "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.5-flash", "gemini-3-flash-preview", "gemini-2.5-flash"].filter(Boolean))];
let workingModel = null;
const deadModels = new Set();
async function callGemini(model, key, prompt) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST", signal: ctrl.signal, headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.2 } }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err = new Error(`Gemini ${res.status} (${model}): ${body.slice(0, 160).replace(/\s+/g, " ")}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    const raw = data.candidates[0].content.parts.map((p) => p.text || "").join("");
    const out = JSON.parse(raw.replace(/^```(json)?|```$/g, "").trim());
    if (!out.explanation) throw new Error("empty AI answer");
    return out;
  } finally { clearTimeout(t); }
}
async function aiExplain(r) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return ruleExplanation(r);
  const prompt = `Tu es l'assistant anti-arnaque de Sahih. Le verdict a DÉJÀ été établi par le registre Hedera, tu ne dois pas le changer.
Verdict: ${VERDICT_FR[r.verdict]}
Institution concernée: ${r.institution ? r.institution.name : "aucune"}
Contrôles: ${r.checks.map((c) => `${c.ok ? "OK" : "KO"} ${c.label} (${c.detail})`).join("; ")}
Signaux détectés: ${r.flags.map((f) => f.label).join(", ") || "aucun"}
${r.diff ? `Différences avec l'original: retiré [${r.diff.removed.join(", ")}], ajouté [${r.diff.added.join(", ")}]` : ""}
Message analysé: """${r.text.slice(0, 1500)}"""
Réponds en JSON: {"explanation": "2 phrases simples en français pour un citoyen, sans jargon", "advice": ["3 conseils concrets courts"]}`;
  const candidates = workingModel ? [workingModel, ...MODELS.filter((m) => m !== workingModel)] : MODELS.filter((m) => !deadModels.has(m));
  for (const model of candidates) {
    try {
      const out = await callGemini(model, key, prompt);
      if (workingModel !== model) console.log(`AI: using ${model}`);
      workingModel = model;
      return { source: `gemini (${model})`, explanation: String(out.explanation), advice: (out.advice || []).map(String).slice(0, 4) };
    } catch (e) {
      console.warn("AI:", e.message);
      if (e.status === 404 || e.status === 400) deadModels.add(model);
      if (e.status === 401 || e.status === 403) break; // bad key: no point trying other models
    }
  }
  return ruleExplanation(r);
}

const pending = new Map(); // id -> analysis waiting for its AI explanation
// Real usage metrics per institution (how often citizens check messages in its name, and what they find)
function countVerification(r) {
  try {
    const stats = h.read("stats.json", { total: {}, byInst: {}, daily: {} });
    const day = new Date().toISOString().slice(0, 10);
    stats.total[r.verdict] = (stats.total[r.verdict] || 0) + 1;
    stats.daily[day] = (stats.daily[day] || 0) + 1;
    if (r.institution) {
      const s = (stats.byInst[r.institution.id] = stats.byInst[r.institution.id] || { verdicts: {}, daily: {} });
      s.verdicts[r.verdict] = (s.verdicts[r.verdict] || 0) + 1;
      s.daily[day] = (s.daily[day] || 0) + 1;
    }
    h.write("stats.json", stats);
  } catch (e) { console.warn("stats:", e.message); }
}
async function finish(withAI, r) {
  r.verdictLabel = VERDICT_FR[r.verdict];
  countVerification(r);
  if (withAI) {
    r.ai = await aiExplain(r);
    r.aiDigest = h.sha256(JSON.stringify({ v: r.verdict, e: r.ai.explanation })).slice(0, 16); // auditable AI output
  } else {
    r.ai = { ...ruleExplanation(r), pending: !!process.env.GEMINI_API_KEY };
    r.aiDigest = h.sha256(JSON.stringify({ v: r.verdict, e: r.ai.explanation })).slice(0, 16);
    r.id = h.sha256(r.hash + Date.now() + Math.random()).slice(0, 20);
    pending.set(r.id, r);
    if (pending.size > 500) pending.delete(pending.keys().next().value);
  }
  r.links = {
    topic: r.publication ? `${h.HASHSCAN}/topic/${r.publication.topicId}` : r.institution ? `${h.HASHSCAN}/topic/${r.institution.topicId}` : null,
    account: r.institution ? `${h.HASHSCAN}/account/${r.institution.account}` : null,
  };
  return r;
}

// Posters: find the signed images that look like the one received (perceptual hash)
function matchImage({ variants, sha256 }) {
  const inst = (id) => store.institutions().find((i) => i.id === id);
  const valid = (p) => { const i = inst(p.instId); return i && i.status === "ACCREDITED" && h.verifySig(i.publicKey, p.hash, p.sig); };
  const pubs = store.publications().filter((p) => p.media);
  const exact = sha256 && pubs.find((p) => p.hash === sha256);
  const ham = (a, b) => { let n = 0; for (let i = 0; i < 16; i++) { let v = parseInt(a[i], 16) ^ parseInt(b[i], 16); while (v) { n += v & 1; v >>= 1; } } return n; };
  const cands = [];
  for (const p of pubs) for (const v of (variants || []).slice(0, 4)) {
    if (!/^[0-9a-f]{16}$/.test(String(v.dhash))) continue;
    const d = ham(p.media.dhash, v.dhash);
    if (d <= 12) cands.push({ p, crop: Number(v.crop) || 0, distance: d });
  }
  cands.sort((a, b) => a.distance - b.distance);
  const seen = new Set();
  const out = (exact ? [{ p: exact, crop: 0, distance: 0, exact: true }] : []).concat(cands)
    .filter((c) => { const k = c.p.code + ":" + c.crop; return !seen.has(k) && seen.add(k); }).slice(0, 4)
    .map((c) => ({ ...c, valid: valid(c.p), institution: publicInst(inst(c.p.instId)) }))
    .map(({ p, crop, distance, exact: ex, valid: ok, institution }) => ({
      code: p.code, title: p.title, text: p.text, at: p.consensusAt || p.at, media: p.media, topicId: p.topicId, sequence: p.sequence,
      crop, distance, exact: !!ex, signatureValid: ok, institution, links: { topic: `${h.HASHSCAN}/topic/${p.topicId}` },
    }));
  return { candidates: out };
}
// Final verdict of an image check (computed in the browser against the official image), counted in the stats
function countImageVerdict({ code, verdict }) {
  const ok = ["AUTHENTIC", "MODIFIED", "UNKNOWN"];
  if (!ok.includes(verdict)) return { ok: false };
  const p = code && store.publications().find((x) => x.code === String(code));
  countVerification({ verdict, institution: p ? { id: p.instId } : null });
  return { ok: true };
}

function byCode(code) {
  const c = String(code || "").trim().toUpperCase();
  const p = store.publications().find((x) => x.code === c);
  if (!p) return null;
  const inst = store.institutions().find((i) => i.id === p.instId);
  return {
    verdict: inst && inst.status === "ACCREDITED" && h.verifySig(inst.publicKey, p.hash, p.sig) ? "AUTHENTIC" : "FAKE",
    publication: p, institution: publicInst(inst),
    links: { topic: `${h.HASHSCAN}/topic/${p.topicId}` },
  };
}

async function explain(id) {
  const r = pending.get(id);
  if (!r) return null;
  const ai = await aiExplain(r);
  const aiDigest = h.sha256(JSON.stringify({ v: r.verdict, e: ai.explanation })).slice(0, 16);
  r.ai = ai; r.aiDigest = aiDigest;
  return { ai, aiDigest };
}

module.exports = { analyze, explain, byCode, matchImage, countImageVerdict, VERDICT_FR };
