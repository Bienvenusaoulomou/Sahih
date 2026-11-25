// Sahih — security primitives: password hashing, signed sessions, encryption of institution keys at rest
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "data");
const SECRET_FILE = path.join(DATA_DIR, "secret.key");

let _secret;
function secret() {
  if (_secret) return _secret;
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32) {
    _secret = Buffer.from(process.env.SESSION_SECRET);
  } else {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(SECRET_FILE)) fs.writeFileSync(SECRET_FILE, crypto.randomBytes(48).toString("hex"), { mode: 0o600 });
    _secret = Buffer.from(fs.readFileSync(SECRET_FILE, "utf8").trim());
  }
  return _secret;
}

// ---- passwords (scrypt, per-user salt, constant-time compare)
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}
function verifyPassword(pw, stored) {
  try {
    const [, saltHex, hashHex] = String(stored).split("$");
    const hash = crypto.scryptSync(String(pw), Buffer.from(saltHex, "hex"), 64, { N: 16384, r: 8, p: 1 });
    return crypto.timingSafeEqual(hash, Buffer.from(hashHex, "hex"));
  } catch { return false; }
}
function checkPasswordStrength(pw) {
  pw = String(pw || "");
  if (pw.length < 10) return "Le mot de passe doit contenir au moins 10 caractères.";
  if (!/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) return "Le mot de passe doit contenir des lettres et des chiffres.";
  return null;
}

// ---- signed session tokens (HMAC-SHA256)
const b64u = (b) => Buffer.from(b).toString("base64url");
function signToken(payload, ttlSeconds = 8 * 3600) {
  const body = b64u(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds }));
  const sig = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}
function verifyToken(token) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return p.exp > Date.now() / 1000 ? p : null;
  } catch { return null; }
}

// ---- encryption at rest (AES-256-GCM) for institution private keys
const encKey = () => crypto.createHash("sha256").update(Buffer.concat([secret(), Buffer.from("sahih-keystore")])).digest();
function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", encKey(), iv);
  const enc = Buffer.concat([c.update(String(text), "utf8"), c.final()]);
  return `enc:${iv.toString("hex")}:${c.getAuthTag().toString("hex")}:${enc.toString("hex")}`;
}
function decrypt(value) {
  if (!String(value).startsWith("enc:")) return value; // legacy plain value
  const [, ivHex, tagHex, dataHex] = value.split(":");
  const d = crypto.createDecipheriv("aes-256-gcm", encKey(), Buffer.from(ivHex, "hex"));
  d.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([d.update(Buffer.from(dataHex, "hex")), d.final()]).toString("utf8");
}

// ---- tiny in-memory rate limiter (login brute force)
const hits = new Map();
function rateLimited(key, max = 8, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  return arr.length > max;
}

const randomPassword = () => crypto.randomBytes(9).toString("base64url") + "7a";

module.exports = { hashPassword, verifyPassword, checkPasswordStrength, signToken, verifyToken, encrypt, decrypt, rateLimited, randomPassword };
