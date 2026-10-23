// The Telegram bot: paste a casino link, a game bot or a wallet and get the check in the chat. In groups it only
// answers /check, so normal chat isn't read. Telegram calls POST /telegram/webhook (scripts/telegram-setup.sh).
import { createHash, timingSafeEqual } from "crypto";
import type { Request, Response } from "express";
import type { CheckResult, Finding } from "./check/types";

export const SITE = "https://cashout-check-1021990235790.us-central1.run.app";
const ICON: Record<Finding["result"], string> = { fail: "❌", warn: "⚠️", info: "ℹ️", pass: "✅", unknown: "❔" };
export const VERDICT_LINE: Record<CheckResult["verdict"], string> = {
  DONT_DEPOSIT: "🔴 <b>Don't deposit</b>",
  CAREFUL: "🟡 <b>Be careful</b>",
  NO_KNOWN_TRAPS: "🟢 <b>No known traps found</b>",
  UNKNOWN: "⚪ <b>Couldn't check</b>",
};
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const HELP = [
  "💸 <b>CashOut Check</b>: will this casino or game ever let you cash out?",
  "",
  "<b>Paste one of these:</b>",
  "🎰 a casino or game <b>website</b>",
  "🤖 a Telegram game <b>bot or channel</b> (t.me/name or @name)",
  "👛 a <b>wallet address</b> they told you to pay",
  "",
  "I check for the known ways people lose money: fake winnings, paying to withdraw, copied licences, throwaway sites, balances that only exist on your phone.",
  "",
  "In a group: /check &lt;link, @bot or wallet&gt;",
  "Free. Every finding names its source. \"No known traps found\" never means safe.",
].join("\n");

export function formatResult(r: CheckResult): string {
  const shown = r.findings.filter((f) => f.result !== "pass" || r.verdict === "NO_KNOWN_TRAPS").slice(0, 8);
  const lines = [
    VERDICT_LINE[r.verdict],
    esc(r.headline),
    `<code>${esc(r.input.slice(0, 80))}</code>`,
    "",
    ...shown.map((f) => `${ICON[f.result]} ${esc(f.detail)}`),
    "",
    `<i>Sources: ${esc([...new Set(shown.map((f) => f.source.split(" (")[0]))].slice(0, 4).join("; "))}</i>`,
    r.verdict === "DONT_DEPOSIT" ? "Never pay a fee, tax or deposit to \"unlock\" a withdrawal. Never connect your wallet or share a seed phrase." : "",
    `<a href="${SITE}/?q=${encodeURIComponent(r.input)}">Full report</a>`,
  ];
  const text = lines.filter((l, i, all) => !(l === "" && all[i - 1] === "")).join("\n");
  return text.length > 4000 ? `${text.slice(0, 3990)}…` : text;
}

export type Ask = { kind: "check"; input: string } | { kind: "help" } | { kind: "myid" } | { kind: "none" };
export function parseAsk(text: string, isGroup: boolean): Ask {
  const t = text.trim();
  const cmd = t.match(/^\/([a-z_]+)(?:@\w+)?\s*([\s\S]*)$/i);
  const name = cmd?.[1].toLowerCase();
  if (name === "start" || name === "help") return { kind: "help" };
  if (name === "myid") return { kind: "myid" };
  if (name === "check") return cmd![2].trim() ? { kind: "check", input: cmd![2].trim().split(/\s+/)[0] } : { kind: "help" };
  if (isGroup || name) return { kind: "none" };
  // A private chat: the first link, @name or long code in the message.
  const token = t.match(/(https?:\/\/\S+|t\.me\/\S+|@[A-Za-z0-9_]{4,32}|[A-Za-z0-9_-]{25,90}|[a-z0-9-]+\.[a-z.]{2,}\S*)/i)?.[0];
  return token ? { kind: "check", input: token } : { kind: "help" };
}

export type BotDeps = {
  check: (input: string, who: { userId: number; owner: boolean }) => Promise<CheckResult | "limit">;
  send: (chatId: number, html: string, replyTo?: number) => Promise<void>;
  ownerIds: Set<number>;
};

export async function handleUpdate(update: any, deps: BotDeps) {
  const msg = update?.message;
  if (!msg?.text || !msg.from || msg.from.is_bot) return;
  const isGroup = msg.chat.type !== "private";
  const reply = (html: string) => deps.send(msg.chat.id, html, isGroup ? msg.message_id : undefined);
  const ask = parseAsk(msg.text, isGroup);
  if (ask.kind === "none") return;
  if (ask.kind === "help") return reply(HELP);
  if (ask.kind === "myid") return reply(`Your Telegram user ID is <code>${msg.from.id}</code>.`);
  await reply("🔎 Checking… this can take up to a minute.");
  const r = await deps.check(ask.input, { userId: msg.from.id, owner: deps.ownerIds.has(msg.from.id) });
  await reply(r === "limit" ? "You've reached today's free checks. They reset at 00:00 UTC." : formatResult(r));
}

export const webhookSecret = (token: string) => createHash("sha256").update(`cashout-telegram-webhook:${token}`).digest("hex");

export function telegramWebhook(token: string, deps: BotDeps) {
  const secret = Buffer.from(webhookSecret(token));
  const seen: number[] = [];
  return async (req: Request, res: Response) => {
    const given = Buffer.from(String(req.headers["x-telegram-bot-api-secret-token"] ?? ""));
    if (given.length !== secret.length || !timingSafeEqual(given, secret)) return res.status(401).json({ error: "Not Telegram." });
    const id = Number(req.body?.update_id);
    // Answer Telegram at once (checks are slow; it would resend), then work. Cloud Run keeps CPU on (--no-cpu-throttling).
    res.json({ ok: true });
    if (seen.includes(id)) return;
    seen.push(id); if (seen.length > 500) seen.shift();
    try { await handleUpdate(req.body, deps); } catch (error) { console.error("telegram update failed:", error); }
  };
}

export function telegramSend(token: string) {
  return async (chatId: number, html: string, replyTo?: number) => {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: "HTML", link_preview_options: { is_disabled: true },
        ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}) }),
    }).catch((e) => { console.error("telegram send failed:", e); return null; });
    const data: any = await r?.json().catch(() => ({}));
    if (r && !data?.ok) console.error("telegram send failed:", data?.description);
  };
}
