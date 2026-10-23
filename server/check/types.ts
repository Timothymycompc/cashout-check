// One finding per rule. Every finding names where its fact came from, and why the rule exists (the real case).
export type Result = "fail" | "warn" | "info" | "pass" | "unknown";
export type Finding = { rule: string; result: Result; detail: string; source: string; why: string };

// The answer a person sees first.
// DONT_DEPOSIT: a known trap is present. CAREFUL: warning signs. NO_KNOWN_TRAPS: none of the traps we know about were
// found (it never means "safe"). UNKNOWN: we couldn't check enough to say anything.
export type Verdict = "DONT_DEPOSIT" | "CAREFUL" | "NO_KNOWN_TRAPS" | "UNKNOWN";

export type CheckResult = {
  input: string;
  kind: "site" | "telegram" | "wallet" | "unknown";
  verdict: Verdict;
  headline: string;
  findings: Finding[];
  facts: Record<string, unknown>;
  checked_at: string;
};

// Ad IDs seen on sites checked before, so a new check can say "the same ID is on these other sites".
// The server keeps them in its database; tests and the command line run without one.
export type Memory = {
  sitesWithTrackers: (ids: string[], except: string) => Promise<Record<string, string[]>>;
  rememberTrackers: (domain: string, ids: string[]) => Promise<void>;
};

export function verdictOf(findings: Finding[]): Verdict {
  if (findings.some((f) => f.result === "fail")) return "DONT_DEPOSIT";
  if (findings.some((f) => f.result === "warn")) return "CAREFUL";
  // At least one real check has to have run; a page of "unknown" is not a clean result.
  if (findings.some((f) => f.result === "pass")) return "NO_KNOWN_TRAPS";
  return "UNKNOWN";
}

// Short names for each rule, for the "checked, nothing found" list.
export const RULE_NAMES: Record<string, string> = {
  known_case: "our scam case files", domain_age: "domain age", scam_kit: "fake-casino kit", pay_to_withdraw: "pay to withdraw",
  withdrawal_locked: "locked withdrawals", unfinished_template: "template leftovers", license: "licence", fake_game_studio: "fake game studios",
  hides_its_code: "hidden code", wallets_in_code: "wallets in its code", earn_from_nothing: "earnings from no token",
  inflated_views: "bought views", never_pays_out: "never pays out", wallet_activity: "wallet activity",
};
