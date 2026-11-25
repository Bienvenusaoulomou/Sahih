// Sahih — Telegram bot (long polling, no extra dependency)
// Citizens forward a suspicious message → the bot replies with the Hedera-backed verdict.
const engine = require("./engine");
const reg = require("./registry");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API = `https://api.telegram.org/bot${TOKEN}`;
const ICON = { AUTHENTIC: "✅", OFFICIAL_CHANNEL: "✅", MODIFIED: "⚠️", FAKE: "❌", NOT_OFFICIAL: "⛔", SUSPICIOUS: "🚩", UNKNOWN: "❓" };
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const lastResult = new Map(); // chatId -> last analysis (for the "Signaler" button)

async function call(method, body) {
  const res = await fetch(`${API}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return res.json();
}

function format(r) {
  const lines = [`${ICON[r.verdict]} <b>${esc(r.verdictLabel)}</b>`];
  if (r.institution) lines.push(`Institution : <b>${esc(r.institution.name)}</b>`);
  if (r.publication && r.verdict === "AUTHENTIC") lines.push(`Publié le ${new Date(r.publication.at).toLocaleString("fr-FR")} · code ${esc(r.publication.code)}`);
  if (r.verdict === "MODIFIED" && r.diff) {
    if (r.diff.removed.length) lines.push(`Original : « ${esc(r.diff.removed.join(" "))} »`);
    if (r.diff.added.length) lines.push(`Modifié en : « ${esc(r.diff.added.join(" "))} »`);
  }
  lines.push("", esc(r.ai.explanation));
  if (r.flags && r.flags.length) lines.push("", "🚩 " + r.flags.map((f) => esc(f.label)).join("\n🚩 "));
  if (r.ai.advice && r.ai.advice.length) lines.push("", r.ai.advice.map((a) => "• " + esc(a)).join("\n"));
  if (r.links && r.links.topic) lines.push("", `<a href="${r.links.topic}">Preuve sur Hedera</a>`);
  return lines.join("\n");
}

async function handle(update) {
  if (update.callback_query) {
    const q = update.callback_query;
    const r = lastResult.get(q.message.chat.id);
    if (q.data === "report" && r) {
      try {
        await reg.report({ text: r.text, verdict: r.verdict, claimedId: r.institution && r.institution.id, domains: r.hosts, aiDigest: r.aiDigest });
        await call("answerCallbackQuery", { callback_query_id: q.id, text: "Merci ! Signalement enregistré sur Hedera." });
      } catch (e) { await call("answerCallbackQuery", { callback_query_id: q.id, text: "Erreur : " + e.message }); }
    }
    return;
  }
  const m = update.message;
  if (!m) return;
  const text = m.text || m.caption || "";
  if (!text || text === "/start" || text === "/help") {
    return call("sendMessage", {
      chat_id: m.chat.id, parse_mode: "HTML",
      text: "👋 <b>Sahih</b> vérifie si un message vient vraiment d'une institution.\n\nTransférez-moi ou collez un SMS, un communiqué ou un lien suspect. Je le compare au registre officiel sur Hedera et je vous réponds en quelques secondes.\n\nVous avez un code <code>SAH-XXXXXX</code> ? Envoyez-le simplement.",
    });
  }
  await call("sendChatAction", { chat_id: m.chat.id, action: "typing" });
  let r;
  const code = text.trim().match(/^SAH-[0-9A-F]{6}$/i);
  if (code) {
    const c = engine.byCode(code[0]);
    const body = c ? `${ICON[c.verdict]} <b>${c.verdict === "AUTHENTIC" ? "Authentique" : "Invalide"}</b>\n${esc(c.institution && c.institution.name)} · ${esc(c.publication.title)}\n\n${esc(c.publication.text || "(message privé : empreinte uniquement)")}\n\n<a href="${c.links.topic}">Preuve sur Hedera</a>` : "❓ Code inconnu.";
    return call("sendMessage", { chat_id: m.chat.id, parse_mode: "HTML", text: body, disable_web_page_preview: true });
  }
  try { r = await engine.analyze({ text, sender: m.forward_sender_name || "" }); }
  catch (e) { return call("sendMessage", { chat_id: m.chat.id, text: "Erreur : " + e.message }); }
  lastResult.set(m.chat.id, r);
  const keyboard = ["AUTHENTIC", "OFFICIAL_CHANNEL"].includes(r.verdict) ? undefined : { inline_keyboard: [[{ text: "🚨 Signaler ce message", callback_data: "report" }]] };
  return call("sendMessage", { chat_id: m.chat.id, parse_mode: "HTML", text: format(r), reply_markup: keyboard, disable_web_page_preview: true, reply_to_message_id: m.message_id });
}

async function start() {
  const me = await call("getMe", {}).catch(() => null);
  if (!me || !me.ok) return console.warn("Telegram bot: invalid TELEGRAM_BOT_TOKEN");
  process.env.TELEGRAM_BOT_USERNAME = me.result.username;
  console.log(`Telegram bot running → https://t.me/${me.result.username}`);
  let offset = 0;
  for (;;) {
    try {
      const res = await call("getUpdates", { offset, timeout: 25, allowed_updates: ["message", "callback_query"] });
      for (const u of res.result || []) {
        offset = u.update_id + 1;
        handle(u).catch((e) => console.error("bot:", e.message));
      }
    } catch (e) {
      console.error("Telegram polling error:", e.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

module.exports = { start, format };
