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

export function verdictOf(findings: Finding[]): Verdict {
  if (findings.some((f) => f.result === "fail")) return "DONT_DEPOSIT";
  if (findings.some((f) => f.result === "warn")) return "CAREFUL";
  // At least one real check has to have run; a page of "unknown" is not a clean result.
  if (findings.some((f) => f.result === "pass")) return "NO_KNOWN_TRAPS";
  return "UNKNOWN";
}
