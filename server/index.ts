// CashOut Check server: the web page, POST /api/check (also used by the page) and the Telegram bot, one engine.
import "dotenv/config";
import express from "express";
import rateLimit from "express-rate-limit";
import { liveNet } from "./net";
import { runCheck } from "./check";
import type { CheckResult } from "./check/types";
import { loadSecrets } from "./secrets";
import { logCheck, openDb, openTrackerMemory, ownerStats } from "./db";
import { PAGE } from "./page";
import { telegramSend, telegramWebhook } from "./telegram";
import { KNOWN_CASES } from "./check/known";

// Free, with a daily cap per person: each check makes 10-40 outside lookups, and the sources we read are free too.
export const DAILY_CHECKS = 30;
const CACHE_MS = 10 * 60_000;

async function main() {
  await loadSecrets(["CASHOUT_DATABASE_URL", "CASHOUT_TELEGRAM_BOT_TOKEN", "CASHOUT_TELEGRAM_OWNER_IDS", "CASHOUT_OWNER_KEY", "CASHOUT_CALLER_HASH_SECRET"]);
  await openDb().catch((e) => console.error("database unavailable, checks won't be logged:", e));
  const memory = await openTrackerMemory().catch((e) => { console.error("tracker memory unavailable:", e); return undefined; });

  // The same input checked twice in 10 minutes gets the same answer, without asking every source again.
  const cache = new Map<string, { at: number; result: Promise<CheckResult> }>();
  const used = new Map<string, number>();
  setInterval(() => used.clear(), 3600_000).unref();
  const today = () => new Date().toISOString().slice(0, 10);
  async function check(input: string, via: string, caller: string | null, owner: boolean): Promise<CheckResult | "limit"> {
    const k = `${today()}|${caller}`;
    if (!owner && caller && (used.get(k) ?? 0) >= DAILY_CHECKS) return "limit";
    used.set(k, (used.get(k) ?? 0) + 1);
    const key = input.trim().toLowerCase();
    const hit = cache.get(key);
    const started = Date.now();
    const result = hit && Date.now() - hit.at < CACHE_MS ? hit.result : runCheck(liveNet, input, Date.now(), memory);
    if (!hit || hit.result !== result) cache.set(key, { at: Date.now(), result });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    const r = await result;
    void logCheck({ via, caller, owner, kind: r.kind, verdict: r.verdict, input, result: r, ms: Date.now() - started });
    return r;
  }

  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "16kb" }));
  app.use((_req, res, next) => { res.setHeader("Strict-Transport-Security", "max-age=31536000"); next(); });

  app.get("/", (_req, res) => res.type("html").send(PAGE));
  app.get("/health", (_req, res) => res.json({ ok: true, cases: KNOWN_CASES.length }));

  const ownerKey = process.env.CASHOUT_OWNER_KEY;
  const isOwner = (req: express.Request) => Boolean(ownerKey) && req.get("x-owner-key") === ownerKey;
  app.post("/api/check", rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: "Too many checks at once. Wait a minute." } }), async (req, res) => {
    const input = typeof req.body?.input === "string" ? req.body.input.trim() : "";
    if (!input || input.length > 300) return res.status(400).json({ error: "Send {\"input\": \"<casino link, t.me/bot or wallet>\"}." });
    try {
      const r = await check(input, req.get("x-from") === "page" ? "web" : "api", req.ip ?? null, isOwner(req));
      if (r === "limit") return res.status(429).json({ error: `That's today's ${DAILY_CHECKS} free checks. They reset at 00:00 UTC.` });
      res.json(r);
    } catch (error) {
      console.error("check failed:", error);
      res.status(502).json({ error: "The check failed. Try again in a moment." });
    }
  });

  app.get("/api/owner/stats", async (req, res) => {
    if (!isOwner(req)) return res.status(401).json({ error: "Owner key needed (x-owner-key)." });
    res.json((await ownerStats()) ?? { error: "No database." });
  });

  const token = process.env.CASHOUT_TELEGRAM_BOT_TOKEN;
  if (token) {
    const ownerIds = new Set((process.env.CASHOUT_TELEGRAM_OWNER_IDS ?? "").split(",").map((s) => Number(s.trim())).filter(Boolean));
    app.post("/telegram/webhook", telegramWebhook(token, { send: telegramSend(token), ownerIds,
      check: (input, who) => check(input, "telegram", `tg:${who.userId}`, who.owner) }));
    console.log("Telegram bot on");
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => console.log(`CashOut Check on :${port}`));
}

void main();
