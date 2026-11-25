// Sahih — subscriptions, quotas, invoices (traceable on Hedera)
// Citizens are always free. Institutions choose Pro or Premium (same offer for every type of institution).
// Sahih pays the Hedera fees in HBAR; institutions pay in dinars.
const crypto = require("crypto");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const path = require("path");
const { TopicCreateTransaction } = require("@hashgraph/sdk");
const h = require("./hedera");
const reg = require("./registry");

const PLANS = {
  PRO: { id: "PRO", name: "Pro", price: 249, quota: 5000, overage: 0.02,
    features: ["5 000 messages signés par mois", "Codes SAH et QR codes", "Alertes d'usurpation", "Tableau de bord et statistiques", "API d'intégration (passerelle SMS)"] },
  PREMIUM: { id: "PREMIUM", name: "Premium", price: 790, quota: 50000, overage: 0.01,
    features: ["50 000 messages signés par mois", "Tout ce que contient Pro", "Multi-signature (plusieurs responsables)", "Alertes en temps réel prioritaires", "Support prioritaire et accompagnement"] },
};
const TRIAL = { days: 30, quota: 100 };
const TVA = 0.19;          // TVA Tunisie
const TIMBRE = 1.0;        // droit de timbre sur facture (TND)
const SELLER = {
  name: process.env.SELLER_NAME || "Sahih",
  line: process.env.SELLER_ADDRESS || "Plateforme de vérification des messages officiels — Tunis, Tunisie",
  mf: process.env.SELLER_TAX_ID || "[matricule fiscal à compléter]",
  rib: process.env.SELLER_RIB || "[RIB à compléter]",
};
const fail = (m, s = 400) => Object.assign(new Error(m), { status: s });
const r3 = (n) => Math.round(n * 1000) / 1000;
const tnd = (n) => `${r3(n).toFixed(3).replace(".", ",")} TND`;
const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);
const monthRange = (key) => { const [y, m] = key.split("-").map(Number); return { start: new Date(Date.UTC(y, m - 1, 1)).toISOString(), end: new Date(Date.UTC(y, m, 1) - 1).toISOString() }; };
const nextMonth = (key) => { const [y, m] = key.split("-").map(Number); return monthKey(new Date(Date.UTC(y, m, 1))); };
const monthLabel = (key) => new Date(key + "-15").toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

const subs = () => h.read("subscriptions.json", {});
const saveSubs = (v) => h.write("subscriptions.json", v);
const invoices = () => h.read("invoices.json", []);
const saveInvoices = (v) => h.write("invoices.json", v);

function usage(instId, key = monthKey()) {
  return reg.store.publications().filter((p) => p.instId === instId && String(p.at || "").startsWith(key)).length;
}
function subscription(instId) {
  const s = subs()[instId];
  if (s && s.status === "ACTIVE") return s;
  const inst = reg.store.institutions().find((i) => i.id === instId);
  const since = (s && s.trialStart) || (inst && inst.accreditedAt) || new Date().toISOString();
  const ends = new Date(new Date(since).getTime() + TRIAL.days * 864e5).toISOString();
  return { status: new Date(ends) > new Date() ? "TRIAL" : "EXPIRED", plan: null, trialStart: since, trialEnds: ends, requestedPlan: s && s.requestedPlan };
}
function quotaInfo(instId) {
  const sub = subscription(instId);
  const used = usage(instId);
  const quota = sub.status === "ACTIVE" ? PLANS[sub.plan].quota : TRIAL.quota;
  return { sub, used, quota, pct: Math.min(100, Math.round((used / quota) * 100)) };
}
// Called before every publication
function assertCanPublish(instId) {
  const { sub, used, quota } = quotaInfo(instId);
  if (sub.status === "ACTIVE") return; // over quota: allowed, billed as overage
  if (sub.status === "EXPIRED") throw fail("Votre période d'essai est terminée. Choisissez l'offre Pro ou Premium dans « Abonnement » pour continuer à publier.", 402);
  if (used >= quota) throw fail(`Quota d'essai atteint (${quota} messages). Choisissez l'offre Pro ou Premium dans « Abonnement ».`, 402);
}

// ---------------------------------------------------------------- Hedera traceability
async function billingTopic() {
  const cfg = reg.store.config();
  if (cfg.billingTopicId) return cfg.billingTopicId;
  const client = h.getClient(), op = h.getOperator();
  const r = await new TopicCreateTransaction().setTopicMemo("Sahih billing - invoices and payments").setSubmitKey(op.key.publicKey).setAdminKey(op.key.publicKey).execute(client);
  cfg.billingTopicId = (await r.getReceipt(client)).topicId.toString();
  reg.save.config(cfg);
  return cfg.billingTopicId;
}
function invoiceHash(inv) {
  const core = { number: inv.number, instId: inv.instId, period: inv.period, items: inv.items, ht: inv.ht, tva: inv.tva, timbre: inv.timbre, ttc: inv.ttc, issuedAt: inv.issuedAt };
  return h.sha256(JSON.stringify(core));
}
async function anchor(payload) {
  const topicId = await billingTopic();
  const { TopicMessageSubmitTransaction } = require("@hashgraph/sdk");
  const client = h.getClient();
  const resp = await new TopicMessageSubmitTransaction().setTopicId(topicId).setMessage(JSON.stringify(payload)).execute(client);
  const rx = await resp.getReceipt(client);
  return { topicId, sequence: Number(rx.topicSequenceNumber.toString()), tx: resp.transactionId.toString() };
}

// ---------------------------------------------------------------- invoices
async function createInvoice(instId, plan, period, extraItems = []) {
  const all = invoices();
  if (all.some((i) => i.instId === instId && i.period === period && i.status !== "CANCELLED")) return all.find((i) => i.instId === instId && i.period === period && i.status !== "CANCELLED");
  const p = PLANS[plan];
  const items = [{ label: `Abonnement Sahih ${p.name} — ${monthLabel(period)}`, qty: 1, unit: p.price, total: p.price }, ...extraItems];
  const ht = r3(items.reduce((a, i) => a + i.total, 0)), tva = r3(ht * TVA), ttc = r3(ht + tva + TIMBRE);
  const year = period.slice(0, 4);
  const seq = all.filter((i) => i.number.startsWith(`SAH-${year}-`)).length + 1;
  const now = new Date();
  const inv = {
    id: crypto.randomUUID(), number: `SAH-${year}-${String(seq).padStart(4, "0")}`, instId, plan, period,
    items, ht, tva, timbre: TIMBRE, ttc, currency: "TND", status: "UNPAID",
    issuedAt: now.toISOString(), dueAt: new Date(now.getTime() + 15 * 864e5).toISOString(), history: [{ at: now.toISOString(), event: "Facture émise" }],
  };
  inv.hash = invoiceHash(inv);
  const a = await anchor({ v: 1, type: "INVOICE", number: inv.number, inst: instId, period, ttc, hash: inv.hash, at: inv.issuedAt });
  Object.assign(inv, { hcsTopic: a.topicId, hcsSeq: a.sequence, hcsTx: a.tx });
  inv.history.push({ at: new Date().toISOString(), event: `Empreinte ancrée sur Hedera (message n° ${a.sequence})` });
  saveInvoices([inv, ...all]);
  return inv;
}
async function subscribe(instId, plan) {
  if (!PLANS[plan]) throw fail("Offre inconnue.");
  const s = subs();
  const cur = subscription(instId);
  if (cur.status === "ACTIVE" && cur.plan === plan) throw fail(`Vous êtes déjà abonné à l'offre ${PLANS[plan].name}.`);
  // cancel an unpaid invoice for another plan this month
  const all = invoices();
  for (const i of all) if (i.instId === instId && i.period === monthKey() && i.status === "UNPAID" && i.plan !== plan) { i.status = "CANCELLED"; i.history.push({ at: new Date().toISOString(), event: "Annulée (changement d'offre)" }); }
  saveInvoices(all);
  s[instId] = { ...(s[instId] || {}), requestedPlan: plan, trialStart: cur.trialStart || (s[instId] || {}).trialStart };
  if (cur.status === "ACTIVE") { s[instId].plan = plan; } // upgrade/downgrade applies now, billed on the new plan
  saveSubs(s);
  return createInvoice(instId, plan, monthKey());
}
function declarePayment(instId, invId, { method, reference }) {
  const all = invoices();
  const inv = all.find((i) => i.id === invId && i.instId === instId);
  if (!inv) throw fail("Facture introuvable.", 404);
  if (inv.status !== "UNPAID") throw fail("Cette facture n'est pas en attente de paiement.");
  if (!reference || String(reference).trim().length < 3) throw fail("Indiquez la référence du virement ou du bon de commande.");
  inv.status = "DECLARED";
  inv.payment = { method: method === "PO" ? "Bon de commande" : "Virement bancaire", reference: String(reference).trim().slice(0, 80), declaredAt: new Date().toISOString() };
  inv.history.push({ at: inv.payment.declaredAt, event: `Paiement déclaré par l'institution (${inv.payment.method}, réf. ${inv.payment.reference})` });
  saveInvoices(all);
  return inv;
}
async function confirmPayment(invId, { method, reference } = {}) {
  const all = invoices();
  const inv = all.find((i) => i.id === invId);
  if (!inv) throw fail("Facture introuvable.", 404);
  if (inv.status === "PAID") throw fail("Cette facture est déjà payée.");
  if (inv.status === "CANCELLED") throw fail("Cette facture est annulée.");
  const paidAt = new Date().toISOString();
  inv.payment = { ...(inv.payment || {}), method: (inv.payment && inv.payment.method) || method || "Virement bancaire", reference: (inv.payment && inv.payment.reference) || reference || "—", confirmedAt: paidAt };
  const a = await anchor({ v: 1, type: "PAYMENT", number: inv.number, inst: inv.instId, amount: inv.ttc, method: inv.payment.method, hash: inv.hash, at: paidAt });
  Object.assign(inv, { status: "PAID", paidAt, paidHcsSeq: a.sequence, paidHcsTx: a.tx });
  inv.history.push({ at: paidAt, event: `Paiement confirmé et enregistré sur Hedera (message n° ${a.sequence})` });
  saveInvoices(all);
  // activate the subscription for the invoiced month
  const s = subs();
  const r = monthRange(inv.period);
  s[inv.instId] = { ...(s[inv.instId] || {}), status: "ACTIVE", plan: inv.plan, periodKey: inv.period, periodStart: r.start, periodEnd: r.end, activatedAt: (s[inv.instId] || {}).activatedAt || paidAt };
  saveSubs(s);
  return inv;
}
// Monthly renewal: new invoice each month for active subscriptions, with last month's overage
async function runRenewals() {
  const s = subs();
  const cur = monthKey();
  let created = 0;
  for (const [instId, sub] of Object.entries(s)) {
    if (sub.status !== "ACTIVE" || !sub.periodKey || sub.periodKey >= cur) continue;
    let key = sub.periodKey;
    while (key < cur) {
      const next = nextMonth(key);
      const p = PLANS[sub.plan], used = usage(instId, key), over = Math.max(0, used - p.quota);
      const extra = over ? [{ label: `Dépassement ${monthLabel(key)} : ${over} messages × ${p.overage.toString().replace(".", ",")} TND`, qty: over, unit: p.overage, total: r3(over * p.overage) }] : [];
      await createInvoice(instId, sub.plan, next, extra); created++;
      key = next;
    }
    const r = monthRange(cur);
    Object.assign(sub, { periodKey: cur, periodStart: r.start, periodEnd: r.end });
  }
  saveSubs(s);
  return created;
}

const forInst = (instId) => invoices().filter((i) => i.instId === instId);
function summary() {
  const all = invoices(), cur = monthKey(), s = subs();
  const active = Object.values(s).filter((x) => x.status === "ACTIVE");
  return {
    mrr: r3(active.reduce((a, x) => a + PLANS[x.plan].price, 0)),
    activeCount: active.length,
    paidThisMonth: r3(all.filter((i) => i.status === "PAID" && String(i.paidAt).startsWith(cur)).reduce((a, i) => a + i.ttc, 0)),
    unpaid: r3(all.filter((i) => i.status === "UNPAID" || i.status === "DECLARED").reduce((a, i) => a + i.ttc, 0)),
    declared: all.filter((i) => i.status === "DECLARED").length,
  };
}
function verify(number, hash) {
  const inv = invoices().find((i) => i.number === String(number).toUpperCase());
  if (!inv) return { found: false };
  return { found: true, number: inv.number, status: inv.status, period: inv.period, ttc: inv.ttc, issuedAt: inv.issuedAt, paidAt: inv.paidAt || null,
    hashMatches: hash ? hash === inv.hash : null, hcs: { topic: inv.hcsTopic, invoiceSeq: inv.hcsSeq, paymentSeq: inv.paidHcsSeq || null }, hashscan: `${h.HASHSCAN}/topic/${inv.hcsTopic}` };
}

// ---------------------------------------------------------------- PDF
async function pdf(inv, baseUrl) {
  const inst = reg.store.institutions().find((i) => i.id === inv.instId) || { name: inv.instId };
  const users = reg.store.users().filter((u) => u.instId === inv.instId).map((u) => u.email);
  const verifyUrl = `${baseUrl}/facture.html?n=${inv.number}&h=${inv.hash}`;
  const qr = await QRCode.toBuffer(verifyUrl, { margin: 1, width: 220 });
  const doc = new PDFDocument({ size: "A4", margin: 50, info: { Title: `Facture ${inv.number}`, Author: SELLER.name } });
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((res) => doc.on("end", () => res(Buffer.concat(chunks))));
  const green = "#0B6B4B", ink = "#14231C", grey = "#6B7A72";
  try { doc.image(path.join(__dirname, "..", "public", "img", "logo-mark.png"), 50, 44, { width: 46 }); } catch {}
  doc.fillColor(ink).font("Helvetica-Bold").fontSize(20).text(SELLER.name, 106, 50);
  doc.font("Helvetica").fontSize(9).fillColor(grey).text(SELLER.line, 106, 74).text(`MF : ${SELLER.mf}`, 106, 86);
  doc.font("Helvetica-Bold").fontSize(22).fillColor(green).text("FACTURE", 380, 48, { width: 165, align: "right" });
  doc.font("Helvetica").fontSize(10).fillColor(ink).text(inv.number, 380, 76, { width: 165, align: "right" });
  doc.fillColor(grey).fontSize(9).text(`Émise le ${new Date(inv.issuedAt).toLocaleDateString("fr-FR")}`, 380, 90, { width: 165, align: "right" })
    .text(`Échéance ${new Date(inv.dueAt).toLocaleDateString("fr-FR")}`, 380, 102, { width: 165, align: "right" });
  doc.moveTo(50, 128).lineTo(545, 128).strokeColor("#D9E1DC").stroke();
  doc.fillColor(grey).fontSize(9).text("FACTURÉ À", 50, 142);
  doc.fillColor(ink).font("Helvetica-Bold").fontSize(12).text(inst.name, 50, 156);
  doc.font("Helvetica").fontSize(9).fillColor(grey).text(`Compte Hedera ${inst.account || "—"}${users.length ? " · " + users[0] : ""}`, 50, 173);
  doc.fillColor(grey).fontSize(9).text("PÉRIODE", 380, 142, { width: 165, align: "right" });
  doc.fillColor(ink).font("Helvetica-Bold").fontSize(12).text(monthLabel(inv.period), 380, 156, { width: 165, align: "right" });
  // table
  let y = 214;
  doc.rect(50, y, 495, 24).fill("#EEF2EF");
  doc.fillColor(ink).font("Helvetica-Bold").fontSize(9).text("Désignation", 60, y + 8).text("Qté", 340, y + 8, { width: 40, align: "right" }).text("P.U. HT", 390, y + 8, { width: 70, align: "right" }).text("Total HT", 465, y + 8, { width: 70, align: "right" });
  y += 30;
  doc.font("Helvetica").fontSize(9.5);
  for (const it of inv.items) {
    doc.fillColor(ink).text(it.label, 60, y, { width: 270 }).text(String(it.qty), 340, y, { width: 40, align: "right" }).text(tnd(it.unit), 390, y, { width: 70, align: "right" }).text(tnd(it.total), 465, y, { width: 70, align: "right" });
    y += Math.max(20, doc.heightOfString(it.label, { width: 270 }) + 8);
  }
  doc.moveTo(50, y).lineTo(545, y).strokeColor("#D9E1DC").stroke(); y += 12;
  const line = (l, v, bold) => { doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9.5).fillColor(ink).text(l, 340, y, { width: 120, align: "right" }).text(v, 465, y, { width: 70, align: "right" }); y += bold ? 20 : 16; };
  line("Total HT", tnd(inv.ht)); line("TVA 19 %", tnd(inv.tva)); line("Droit de timbre", tnd(inv.timbre)); line("Total TTC", tnd(inv.ttc), true);
  // status
  const paid = inv.status === "PAID";
  doc.save().rotate(-10, { origin: [130, y + 10] }).roundedRect(70, y - 10, 150, 44, 6).lineWidth(2.5).strokeColor(paid ? green : "#B8232B").stroke()
    .fillColor(paid ? green : "#B8232B").font("Helvetica-Bold").fontSize(16).text(paid ? "PAYÉE" : inv.status === "DECLARED" ? "PAIEMENT DÉCLARÉ" : "À PAYER", 72, y + 4, { width: 146, align: "center" }).restore();
  y += 60;
  doc.font("Helvetica-Bold").fontSize(10).fillColor(ink).text("Paiement", 50, y); y += 14;
  doc.font("Helvetica").fontSize(9).fillColor(grey);
  if (paid) doc.text(`Payée le ${new Date(inv.paidAt).toLocaleDateString("fr-FR")} · ${inv.payment.method} · réf. ${inv.payment.reference}`, 50, y);
  else doc.text(`Virement bancaire au RIB ${SELLER.rib}, en indiquant la référence ${inv.number}. Les institutions publiques peuvent régler sur bon de commande.`, 50, y, { width: 495 });
  y += 34;
  // traceability box
  doc.roundedRect(50, y, 495, 118, 8).fillAndStroke("#F6F3FF", "#D8D4F2");
  doc.image(qr, 60, y + 9, { width: 100 });
  doc.fillColor("#4B3FA8").font("Helvetica-Bold").fontSize(10).text("Facture traçable sur Hedera", 172, y + 12);
  doc.fillColor(ink).font("Helvetica").fontSize(8.5)
    .text(`Empreinte SHA-256 : ${inv.hash}`, 172, y + 30, { width: 360 })
    .text(`Émission : topic ${inv.hcsTopic}, message n° ${inv.hcsSeq}${inv.paidHcsSeq ? ` · Paiement : message n° ${inv.paidHcsSeq}` : ""}`, 172, y + 56, { width: 360 })
    .text("Scannez le QR code pour vérifier que cette facture n'a pas été modifiée.", 172, y + 74, { width: 360 });
  doc.fillColor(grey).fontSize(8).text(`${h.HASHSCAN}/topic/${inv.hcsTopic}`, 172, y + 94, { width: 360 });
  doc.fillColor(grey).fontSize(7.5).text("Les frais du réseau Hedera sont inclus dans l'abonnement : l'institution ne manipule aucune cryptomonnaie.", 50, 762, { width: 495, align: "center", lineBreak: false });
  doc.end();
  return done;
}

module.exports = { PLANS, TRIAL, TVA, TIMBRE, usage, subscription, quotaInfo, assertCanPublish, subscribe, declarePayment, confirmPayment, runRenewals, forInst, invoices, summary, verify, pdf, monthKey };
