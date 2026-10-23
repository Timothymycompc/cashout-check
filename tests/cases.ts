// Real cases the check is measured on: scams we investigated (must be caught) and ordinary, long-running services
// (must not be called scams). Each one is recorded once (npm run record) and replayed by tests/check.test.ts.
export type Case = { id: string; input: string; expect: "DONT_DEPOSIT" | "CAREFUL" | "NO_KNOWN_TRAPS" | "UNKNOWN"; why: string };

export const CASES: Case[] = [
  // Scams we investigated by hand.
  { id: "luckquexa", input: "https://luckquexa.com", expect: "DONT_DEPOSIT", why: "One of 45 fake crypto casinos with scripted pay-to-withdraw steps (2026-10-21)." },
  { id: "luckquexa-sister-new", input: "spinquelx.com", expect: "DONT_DEPOSIT", why: "A sister site from the same kit, registered 2026-09-30." },
  { id: "progcoin-game", input: "https://torncrypto.com", expect: "DONT_DEPOSIT", why: "Serves the Prog Coin game (2026-10-22)." },
  { id: "progcoin-bot", input: "https://t.me/progcoinbot", expect: "DONT_DEPOSIT", why: "Prog Coin's bot." },
  { id: "progcoin-channel", input: "t.me/progcoinofficial", expect: "DONT_DEPOSIT", why: "Prog Coin's channel." },
  { id: "progcoin-ton-wallet", input: "UQDl4k0rqIwvYxhP_fIx5y0SOZmdCLINVE1yQ2oTkillf7hC", expect: "DONT_DEPOSIT", why: "Prog Coin's TON deposit wallet." },
  // Ordinary services that must not be called scams.
  { id: "draftkings", input: "https://www.draftkings.com", expect: "NO_KNOWN_TRAPS", why: "A US-licensed sportsbook and casino, running since 2012." },
  { id: "telegram-durov", input: "https://t.me/durov", expect: "NO_KNOWN_TRAPS", why: "Telegram founder's channel." },
  { id: "wikipedia", input: "wikipedia.org", expect: "NO_KNOWN_TRAPS", why: "Not a casino at all: must not be judged on casino rules." },
];
