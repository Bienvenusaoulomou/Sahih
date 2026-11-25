// Sahih — Hedera plumbing: client, keys, local cache files, mirror node
require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Client, AccountId, PrivateKey, PublicKey } = require("@hashgraph/sdk");

const NETWORK = process.env.HEDERA_NETWORK || "testnet";
const MIRROR = process.env.MIRROR_NODE_URL ||
  (NETWORK === "mainnet" ? "https://mainnet.mirrornode.hedera.com" : "https://testnet.mirrornode.hedera.com");
const HASHSCAN = `https://hashscan.io/${NETWORK}`;
const DATA_DIR = path.join(__dirname, "..", "data");

// Accepts what portal.hedera.com gives: DER ("302e…"/"3030…"), raw hex, or "0x…" hex
function parsePrivateKey(raw) {
  if (!raw) throw new Error("OPERATOR_KEY is missing in .env");
  const k = raw.trim();
  if (k.startsWith("302")) return PrivateKey.fromStringDer(k);
  const hex = k.startsWith("0x") ? k.slice(2) : k;
  return (process.env.OPERATOR_KEY_TYPE || "ECDSA").toUpperCase() === "ED25519"
    ? PrivateKey.fromStringED25519(hex) : PrivateKey.fromStringECDSA(hex);
}
function getOperator() {
  const id = (process.env.OPERATOR_ID || "").trim();
  if (!/^\d+\.\d+\.\d+$/.test(id)) throw new Error("OPERATOR_ID is missing or invalid in .env (format 0.0.123456)");
  return { id: AccountId.fromString(id), key: parsePrivateKey(process.env.OPERATOR_KEY) };
}
let _client;
function getClient() {
  if (_client) return _client;
  const op = getOperator();
  _client = NETWORK === "mainnet" ? Client.forMainnet() : Client.forTestnet();
  _client.setOperator(op.id, op.key);
  return _client;
}

// ---------- local files (a cache/index — everything public can be rebuilt from Hedera) ----------
function file(name) { return path.join(DATA_DIR, name); }
function read(name, fallback) {
  try { return JSON.parse(fs.readFileSync(file(name), "utf8")); } catch { return fallback; }
}
function write(name, obj) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file(name), JSON.stringify(obj, null, 2));
}

// ---------- text normalisation + fingerprint ----------
function normalize(text) {
  return String(text || "")
    .normalize("NFKC")
    .replace(/[‘’‛`´]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const fingerprint = (text) => sha256(normalize(text));

// ---------- signatures ----------
const sign = (privKey, hashHex) => Buffer.from(privKey.sign(Buffer.from(hashHex, "hex"))).toString("hex");
function verifySig(publicKeyStr, hashHex, sigHex) {
  try {
    const s = String(publicKeyStr);
    const pub = s.startsWith("30") ? PublicKey.fromString(s) : PublicKey.fromStringECDSA(s);
    return pub.verify(Buffer.from(hashHex, "hex"), Buffer.from(sigHex, "hex"));
  } catch { return false; }
}

// ---------- mirror node ----------
async function mirror(p) {
  const res = await fetch(MIRROR + p);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Mirror node ${res.status} on ${p}`);
  return res.json();
}
async function topicMessages(topicId, { limit = 100, order = "asc" } = {}) {
  const data = await mirror(`/api/v1/topics/${topicId}/messages?limit=${limit}&order=${order}`);
  if (!data) return [];
  return data.messages.map((m) => {
    let payload = null;
    try { payload = JSON.parse(Buffer.from(m.message, "base64").toString("utf8")); } catch {}
    return { topicId, sequence: m.sequence_number, ts: m.consensus_timestamp, payer: m.payer_account_id, payload };
  });
}
const tsToIso = (ts) => (ts ? new Date(Number(String(ts).split(".")[0]) * 1000).toISOString() : null);

module.exports = {
  NETWORK, MIRROR, HASHSCAN, PrivateKey, PublicKey,
  getClient, getOperator, read, write,
  normalize, sha256, fingerprint, sign, verifySig,
  mirror, topicMessages, tsToIso,
};
