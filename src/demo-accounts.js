// Creates (or resets) a login for each demo institution and prints the credentials once.
// Usage: npm run demo-accounts   (the server can keep running)
const accounts = require("./accounts");
const reg = require("./registry");

const DEMO = [
  { id: "esprit", email: "communication@esprit.tn" },
  { id: "ministere-du-commerce-demo", email: "communication@commerce-demo.gov.tn", social: ["facebook.com/commercedemo.tn", "x.com/commerce_demo"] },
  { id: "banque-demo", email: "securite@banquedemo.tn", social: ["facebook.com/banquedemo", "instagram.com/banquedemo", "linkedin.com/company/banque-demo", "tiktok.com/@banquedemo", "wa.me/21671111111"] },
];

(async () => {
const insts = reg.store.institutions();
if (!insts.length) { console.log("No institutions yet: run `npm run setup` first."); process.exit(1); }
// Fictional demo institutions: declare their social accounts on Hedera if not done yet
for (const d of DEMO) {
  const inst = insts.find((i) => i.id === d.id);
  if (inst && d.social && !(inst.channels.social || []).length) {
    await reg.updateChannels(d.id, { ...inst.channels, social: d.social });
    console.log(`  ↳ réseaux sociaux de ${inst.name} déclarés sur Hedera`);
  }
}
console.log("\nComptes de démonstration (mots de passe affichés une seule fois) :\n");
for (const d of DEMO) {
  const inst = insts.find((i) => i.id === d.id);
  if (!inst) { console.log(`  ✗ ${d.id} introuvable`); continue; }
  const { email, password } = accounts.createAccess(d.id, d.email);
  console.log(`  ${inst.name.padEnd(30)} ${email.padEnd(38)} ${password}`);
}
console.log("\nConnexion : http://localhost:3000/login.html\n");
process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
