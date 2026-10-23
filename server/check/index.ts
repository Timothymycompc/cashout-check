// The one check: whatever someone pastes (casino link, game bot, deposit wallet), work out what it is and run its rules.
import type { Net } from "../net";
import { parseTarget } from "./input";
import { checkSite } from "./site";
import { checkTelegram } from "./telegram";
import { checkWallet } from "./wallet";
import { verdictOf, type CheckResult, type Finding } from "./types";

export const HEADLINES = {
  DONT_DEPOSIT: "Don't deposit: this matches a known way people lose money.",
  CAREFUL: "Be careful: there are warning signs.",
  NO_KNOWN_TRAPS: "None of the traps we know about were found. That doesn't make it safe.",
  UNKNOWN: "We couldn't check enough to say anything.",
} as const;

export async function runCheck(net: Net, input: string, now = Date.now()): Promise<CheckResult> {
  const target = parseTarget(input);
  let findings: Finding[] = [], facts: Record<string, unknown> = {};
  if (target.kind === "site") ({ findings, facts } = await checkSite(net, target.domain, target.url, now));
  else if (target.kind === "telegram") ({ findings, facts } = await checkTelegram(net, target.username));
  else if (target.kind === "wallet") ({ findings, facts } = await checkWallet(net, target.address, target.chains));
  else findings = [{ rule: "input", result: "unknown", detail: "Paste a casino or game link, a Telegram bot or channel (t.me/name or @name), or a wallet address.", source: "CashOut Check", why: "Each kind has its own checks." }];
  // Worst first, so the reason for the verdict is at the top.
  const order = { fail: 0, warn: 1, info: 2, unknown: 3, pass: 4 };
  findings.sort((a, b) => order[a.result] - order[b.result]);
  const verdict = verdictOf(findings);
  return { input: input.trim().slice(0, 300), kind: target.kind, verdict, headline: HEADLINES[verdict], findings, facts, checked_at: new Date(now).toISOString() };
}
