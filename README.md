# Sahih (صحيح) — proof of origin for official messages, on Hedera

> **Vérifiez en 3 secondes qu'un SMS, un communiqué ou une page vient vraiment d'une institution.**
> Hedera Cross Campus Challenge 2026 — ESPRIT Campus Edition · Team **Sahih Labs**

## The problem
Generative AI makes fake official messages trivial to produce: fake fine SMS, fake ministry press releases, fake bank pages. Citizens have no way to check, and institutions can only say "check our official page".

## How Sahih works
1. **Accreditation.** A trust authority accredits each institution. Its Hedera account, public key and official channels (web domains, SMS sender IDs, phone numbers, social accounts) are written to a **trust registry topic** on Hedera Consensus Service.
2. **Signing.** The institution publishes from its dashboard. Every message is normalized, hashed (SHA-256), signed with the institution's ECDSA key and timestamped by consensus in **its own HCS topic** (only its key can submit). It gets a short code `SAH-XXXXXX` and a QR code, then is shared on its usual channels.
3. **Verification.** Anyone pastes a message on the website or forwards it to the **Telegram bot**, without an account. Verdicts:
   - ✅ **Authentic**: exact match with a signed message
   - ⚠️ **Modified**: close to a signed message, changed words highlighted
   - ❌ **Fake / impersonation**: unknown SAH code, or link, number, sender or account never declared by the institution
   - 🔗 **Official channel**: the link belongs to a declared channel
4. **AI explains, Hedera decides.** Gemini turns the verdict into a plain-language explanation; it never decides authenticity.
5. **Reports.** Citizen reports are timestamped on Hedera and alert the impersonated institution.

## Hedera usage
| What | Where |
|---|---|
| Trust registry (accreditations, revocations, channel updates) | HCS topic, submit key = authority |
| One official channel per institution | HCS topic, submit key = institution |
| Citizen reports | HCS topic |
| Billing (invoice and payment hashes) | HCS topic |
| Institution identities | One Hedera account (ECDSA) each |
| Index rebuild and trustless verification | Mirror Node REST API |

Live testnet IDs:
- Authority account: [0.0.6141886](https://hashscan.io/testnet/account/0.0.6141886)
- Trust registry topic: [0.0.11608025](https://hashscan.io/testnet/topic/0.0.11608025)
- Reports topic: [0.0.11608026](https://hashscan.io/testnet/topic/0.0.11608026)
- Example institution channel: [0.0.11608031](https://hashscan.io/testnet/topic/0.0.11608031)

## MVP features
- Public verification page with live stats and examples
- Institution sign-up, reviewed and approved by the authority
- Secure login: scrypt password hashes, HMAC-signed HttpOnly sessions, rate limiting, institution keys encrypted with AES-256-GCM
- Institution dashboard: publish and sign, share buttons (WhatsApp, Facebook, X, LinkedIn, Telegram), QR codes, publications, reports, official channels, security
- Authority console: applications, institutions, reports, billing, accreditation and revocation
- Subscriptions: free for citizens; **Pro** and **Premium** plans for institutions, monthly renewals, PDF invoices with QR code, invoice and payment hashes anchored on Hedera, public invoice verification page
- Telegram bot

## Run it
Requirements: Node.js 18+, a free Hedera testnet account (ECDSA) from https://portal.hedera.com

```bash
npm install
cp .env.example .env        # fill OPERATOR_ID and OPERATOR_KEY (GEMINI_API_KEY and TELEGRAM_BOT_TOKEN are optional)
npm run setup               # creates the registry, reports topic and 3 demo institutions on testnet
npm run demo-accounts       # creates the demo institution logins (passwords printed once)
npm start                   # http://localhost:3000
```

Pages: `/` (verify) · `/login.html` (institutions) · `/institution.html` (dashboard) · `/authority.html` (authority console) · `/facture.html` (invoice check)

## Stack
Node.js, Express 5, @hashgraph/sdk, Hedera Consensus Service, Mirror Node, Google Gemini API, Telegram Bot API, PDFKit, QRCode.

## Project layout
```
src/hedera.js       Hedera client, hashing, signatures, mirror node
src/registry.js     accreditation, publishing, channels, reports, sync from Hedera
src/engine.js       verification engine + Gemini explanations
src/billing.js      plans, invoices, payments, renewals
src/accounts.js     authority and institution accounts
src/secure.js       password hashing, sessions, encryption, rate limiting
src/bot.js          Telegram bot
src/server.js       HTTP API
public/             website, dashboards, invoice page
```

## License
MIT
