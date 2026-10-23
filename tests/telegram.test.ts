// The Telegram bot: what it reads from a message, and how a real recorded result reads in the chat.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { replayNet } from "../server/net";
import { runCheck } from "../server/check";
import { formatResult, handleUpdate, parseAsk, type BotDeps } from "../server/telegram";

const replay = async (id: string) => {
  const f = JSON.parse(fs.readFileSync(`tests/fixtures/${id}.json`, "utf8"));
  return runCheck(replayNet(`tests/fixtures/${id}.json`), f.input, Date.parse(f.recorded_at));
};

test("reads a link, a bot or a wallet out of a message", () => {
  assert.deepEqual(parseAsk("is https://luckquexa.com legit??", false), { kind: "check", input: "https://luckquexa.com" });
  assert.deepEqual(parseAsk("@progcoinbot", false), { kind: "check", input: "@progcoinbot" });
  assert.deepEqual(parseAsk("UQDl4k0rqIwvYxhP_fIx5y0SOZmdCLINVE1yQ2oTkillf7hC", false).kind, "check");
  assert.deepEqual(parseAsk("hello", false), { kind: "help" });
  assert.deepEqual(parseAsk("look at luckquexa.com", true), { kind: "none" }, "groups: only /check");
  assert.deepEqual(parseAsk("/check@CashOutCheckBot luckquexa.com", true), { kind: "check", input: "luckquexa.com" });
});

test("a Don't deposit answer leads with the traps, names sources and fits one message", async () => {
  const text = formatResult(await replay("luckquexa"));
  assert.match(text, /^🔴 <b>Don't deposit<\/b>/);
  assert.match(text, /Sources:/);
  assert.match(text, /Never pay a fee, tax or deposit/);
  assert.ok(text.length <= 4000);
});

test("a clean answer says it isn't a promise", async () => {
  const text = formatResult(await replay("wikipedia"));
  assert.match(text, /No known traps found/);
  assert.match(text, /doesn't make it safe/);
});

test("the bot says it's checking, then answers; the daily limit is explained", async () => {
  const sent: string[] = [];
  const deps = (result: any): BotDeps => ({ check: async () => result, send: async (_c, h) => { sent.push(h); }, ownerIds: new Set() });
  const msg = { message: { message_id: 1, text: "luckquexa.com", chat: { id: 5, type: "private" }, from: { id: 9, is_bot: false } } };
  await handleUpdate(msg, deps(await replay("luckquexa")));
  assert.match(sent[0], /Checking/);
  assert.match(sent[1], /Don't deposit/);
  await handleUpdate(msg, deps("limit"));
  assert.match(sent[3], /today's free checks/);
});
