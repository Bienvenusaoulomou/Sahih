# Sahih — texts for the 4Hacks submission form (copy and paste)

## Project name
Sahih (صحيح)

## Tagline
FR : Ce message vient-il vraiment d'eux ? La preuve d'origine des messages officiels sur Hedera, vérifiable en 3 secondes.
EN : Did this message really come from them? Proof of origin for official messages on Hedera, verifiable in 3 seconds.

## Track
AI × Web3 Agents (trusted data, auditable AI), with Decentralized Identity

## Problem (FR)
Chaque jour, presque tout le monde reçoit un faux SMS, un faux communiqué ou une fausse alerte bancaire au nom d'une institution. Avec l'IA générative, fabriquer un faux parfait prend quelques secondes. En Tunisie, en 2026, des ministères ont dû démentir à plusieurs reprises de faux communiqués circulant sur les réseaux sociaux (prix des produits subventionnés, examens), et l'ANCS a alerté contre des SMS de fausses amendes qui renvoient vers des sites contrefaits pour voler des coordonnées bancaires. Aujourd'hui, la seule réponse officielle est « consultez notre page officielle ». Les citoyens ne le font pas, et le démenti arrive des heures après les dégâts.

## Problem (EN)
Almost everyone receives fake SMS, fake official statements or fake bank alerts in the name of institutions, nearly every day. With generative AI, a perfect fake takes seconds to make. In Tunisia in 2026, ministries repeatedly had to deny fake statements circulating on social media (subsidised prices, exams), and the national cybersecurity agency (ANCS) warned about phishing SMS sending fake traffic fines that lead to cloned sites built to steal bank details. Today the only official answer is "check our official page". Citizens don't, and the denial comes hours after the damage is done.

## Solution (FR)
Sahih donne à chaque institution accréditée une identité et un canal officiel sur Hedera. Une autorité de confiance inscrit les institutions dans un registre public : compte, clé publique, domaines, expéditeurs SMS et numéros officiels. Chaque message officiel est signé par la clé de l'institution et horodaté par consensus sur Hedera Consensus Service. Un citoyen, sans inscription, colle un message suspect sur le site ou le transfère au bot Telegram. En 3 secondes il obtient un verdict : authentique, version modifiée (les mots changés sont surlignés), usurpation (lien, numéro ou expéditeur jamais déclaré par l'institution), non officiel ou suspect. Gemini explique le verdict en langage simple, mais c'est Hedera qui décide. Les signalements des citoyens sont horodatés sur Hedera et alertent immédiatement l'institution usurpée.

## Solution (EN)
Sahih gives every accredited institution an identity and an official channel on Hedera. A trust authority records institutions in a public registry: account, public key, and official domains, SMS senders and phone numbers. Every official message is signed with the institution's key and time-stamped by consensus on the Hedera Consensus Service. A citizen, with no sign-up, pastes a suspicious message on the web app or forwards it to the Telegram bot. Within 3 seconds they get a verdict: authentic, modified (the changed words are highlighted), impersonation (a link, number or sender the institution never declared), not official, or suspicious. Gemini explains the verdict in plain language, but Hedera decides. Citizen reports are time-stamped on Hedera and alert the impersonated institution immediately.

## Hedera integration (why Hedera)
- **Trust registry (HCS topic, submit key = authority):** ACCREDIT / REVOKE records. Only the authority can write; anyone can read.
- **Institution identity (Hedera accounts, ECDSA keys):** each institution has its own account and key. Threshold keys (multi-sig) are supported natively.
- **Official channels (one HCS topic per institution, submit key = institution):** each PUBLISH holds the SHA-256 fingerprint, the institution's signature and a consensus timestamp (plus the full text for public statements, or only the fingerprint for individual SMS). CHANNELS updates declare the official domains, senders and numbers.
- **Citizen reports (HCS topic):** a public, tamper-proof record of impersonation campaigns. Each report also stores a digest of the AI explanation, so the AI's output can be audited.
- **Mirror Node REST:** the verifier rebuilds its whole index from Hedera alone, so anyone can run it without trusting us.
- **Why Hedera:** consensus timestamps prove who published what and when, and the record can't be changed afterwards, even by the issuer. Native submit keys and threshold keys, plus low, fixed fees, make it affordable to sign every single message.

## Tech stack
Node.js, Express, @hashgraph/sdk (HCS, accounts), Hedera Mirror Node REST API, Google Gemini API, Telegram Bot API, SHA-256, ECDSA secp256k1, HTML/CSS/JS. Network: Hedera Testnet.

## On-chain proof (fill in after `npm run setup`)
- Authority account: 0.0.6141886 → https://hashscan.io/testnet/account/0.0.6141886
- Trust registry topic: 0.0.11608025 → https://hashscan.io/testnet/topic/0.0.11608025
- Reports topic: 0.0.11608026 → https://hashscan.io/testnet/topic/0.0.11608026
- Example institution channel (Ministère du Commerce démo): 0.0.11608031 → https://hashscan.io/testnet/topic/0.0.11608031

## Links
- GitHub: https://github.com/________/sahih
- Telegram bot: https://t.me/sahih_verif_bot
- Pitch deck: (export it as a PDF)

## Team
Mike — 4th-year Cybersecurity Engineering (NIDS), ESPRIT

---

# 5-minute pitch: running order
1. (40 s) Problem: the fake statement and fake fine SMS everyone has received. Close on "consultez notre page".
2. (40 s) Solution in 3 steps: authority, institution, citizen.
3. (2 min) Live demo: real statement ✅ → modified version ⚠️ (highlighted words) → fake bank SMS ❌ → Signaler → alert in the bank's space → forward a message to the Telegram bot.
4. (40 s) Why Hedera: registry, channels, consensus timestamps, Mirror Node.
5. (40 s) Impact, business model, vision. "Quand l'IA peut tout imiter, la preuve d'origine devient un service public."

Before the pitch: run `npm run setup` well in advance, test the bot, and keep HashScan open in a tab in case the Wi-Fi is slow.
