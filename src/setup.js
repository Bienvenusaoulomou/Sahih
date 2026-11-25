// One-time setup: authority registry + reports topic + 3 demo institutions with official messages
const { TopicCreateTransaction } = require("@hashgraph/sdk");
const h = require("./hedera");
const reg = require("./registry");

const DEMO = [
  {
    name: "ESPRIT", kind: "Établissement (pilote)", aliases: "esprit school of engineering, école esprit",
    domains: "esprit.tn", senders: "ESPRIT", phones: "+21670250000",
    posts: [{
      kind: "annonce", title: "Hackathon Hedera — présentation des projets",
      text: "ESPRIT : la présentation des projets du Hedera Cross Campus Challenge a lieu le mercredi 25 novembre 2026 sur le campus. Inscriptions uniquement sur 4hacks.io. Aucun paiement n'est demandé aux participants.",
    }],
  },
  {
    name: "Ministère du Commerce (démo)", kind: "Ministère", aliases: "ministère du commerce, ministere du commerce",
    domains: "commerce-demo.gov.tn", senders: "MINCOMMERCE", phones: "+21671000000",
    social: "facebook.com/commercedemo.tn, x.com/commerce_demo",
    posts: [{
      kind: "communiqué", title: "Prix des produits subventionnés",
      text: "Communiqué : le Ministère du Commerce informe qu'aucune hausse des prix du sucre, du lait et de l'huile subventionnés n'a été décidée. Le prix du sucre reste fixé à 1,350 dinar le kilo. Toute information contraire est infondée.",
    }],
  },
  {
    name: "Banque Démo", kind: "Banque", aliases: "banque demo, banque démo",
    domains: "banquedemo.tn", senders: "BANQUEDEMO", phones: "+21671111111",
    social: "facebook.com/banquedemo, instagram.com/banquedemo, linkedin.com/company/banque-demo, tiktok.com/@banquedemo, wa.me/21671111111",
    posts: [{
      kind: "sms", title: "Rappel sécurité clients",
      text: "Banque Démo : nous ne vous demanderons JAMAIS votre code de confirmation, votre mot de passe ou vos coordonnées bancaires par SMS ou par téléphone. Notre seul site est banquedemo.tn.",
    }],
  },
];

(async () => {
  if (reg.store.config() && !process.argv.includes("--force")) {
    console.log("Already set up:", reg.store.config());
    console.log("Run `npm run setup -- --force` to start over with new topics.");
    process.exit(0);
  }
  if (process.argv.includes("--force")) for (const f of ["institutions", "publications", "reports", "keys"]) reg.save[f](f === "keys" ? {} : []);
  const client = h.getClient();
  const op = h.getOperator();
  console.log(`\nAuthority account: ${op.id} on ${h.NETWORK}\n`);

  const mkTopic = async (memo) => {
    const r = await new TopicCreateTransaction().setTopicMemo(memo).setSubmitKey(op.key.publicKey).setAdminKey(op.key.publicKey).execute(client);
    return (await r.getReceipt(client)).topicId.toString();
  };
  console.log("1/3 Creating the trust registry topic (only the authority can write)...");
  const registryTopicId = await mkTopic("Sahih trust registry - accredited institutions");
  console.log("    Registry:", registryTopicId);
  console.log("2/3 Creating the citizen reports topic...");
  const reportsTopicId = await mkTopic("Sahih citizen reports - impersonation alerts");
  console.log("    Reports:", reportsTopicId);
  reg.save.config({ network: h.NETWORK, authorityAccount: op.id.toString(), authorityName: process.env.AUTHORITY_NAME || "Autorité de confiance Sahih (démo)", registryTopicId, reportsTopicId, createdAt: new Date().toISOString() });

  console.log("3/3 Accrediting demo institutions and publishing their official messages...");
  for (const d of DEMO) {
    const inst = await reg.accredit(d);
    console.log(`    ✓ ${inst.name}: account ${inst.account}, topic ${inst.topicId}`);
    for (const p of d.posts) {
      const pub = await reg.publish(inst.id, p);
      console.log(`      ↳ published "${pub.title}" (${pub.code})`);
    }
  }
  console.log(`\nDone. Registry on HashScan: ${h.HASHSCAN}/topic/${registryTopicId}`);
  console.log("Now run: npm start\n");
  process.exit(0);
})().catch((e) => { console.error("\nSetup failed:", e.message || e); process.exit(1); });
