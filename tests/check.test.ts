// Replays the recorded real cases (tests/cases.ts, recorded with npm run record) and measures two things:
// every case gets the expected answer, and every scam is still flagged with our own case files left out, which is
// what happens for the next scam site nobody has investigated yet.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { replayNet } from "../server/net";
import { runCheck } from "../server/check";
import { parseTarget, registrable } from "../server/check/input";
import { verdictOf } from "../server/check/types";
import { CASES } from "./cases";

const replay = async (id: string) => {
  const f = JSON.parse(fs.readFileSync(`tests/fixtures/${id}.json`, "utf8"));
  return runCheck(replayNet(`tests/fixtures/${id}.json`), f.input, Date.parse(f.recorded_at));
};

for (const c of CASES) {
  test(`${c.id}: ${c.expect} (${c.why})`, async () => {
    const r = await replay(c.id);
    assert.equal(r.verdict, c.expect, r.findings.map((f) => `${f.result} ${f.rule}`).join(", "));
    for (const f of r.findings) {
      assert.ok(f.source && f.why, `${f.rule} names its source and its reason`);
    }
  });
}

// Without the case files: which scams the rules alone still flag. Pinned, so a change that loses one is noticed.
const CAUGHT_BLIND: Record<string, string> = {
  "luckquexa": "DONT_DEPOSIT", "luckquexa-sister-new": "DONT_DEPOSIT", "progcoin-game": "CAREFUL",
  "progcoin-bot": "CAREFUL", "progcoin-channel": "CAREFUL", "progcoin-ton-wallet": "CAREFUL",
};
test("scams are still flagged without our own case files", async () => {
  for (const [id, expected] of Object.entries(CAUGHT_BLIND)) {
    const r = await replay(id);
    assert.equal(verdictOf(r.findings.filter((f) => f.rule !== "known_case")), expected, id);
  }
});

test("works out what was pasted", () => {
  assert.equal(parseTarget("https://t.me/progcoinbot?start=x").kind, "telegram");
  assert.equal(parseTarget("@progcoinbot").kind, "telegram");
  assert.deepEqual(parseTarget("UQDl4k0rqIwvYxhP_fIx5y0SOZmdCLINVE1yQ2oTkillf7hC"), { kind: "wallet", address: "UQDl4k0rqIwvYxhP_fIx5y0SOZmdCLINVE1yQ2oTkillf7hC", chains: ["ton"] });
  assert.deepEqual(parseTarget("0x5b51500f0617ca816Bc66F311937798DA5E2fFCD").kind, "wallet");
  assert.deepEqual(parseTarget("https://pp.pragmaticsplaygames.com/game?x=1"), { kind: "site", domain: "pragmaticsplaygames.com", url: "https://pp.pragmaticsplaygames.com/" });
  assert.equal(registrable("play.gmbl.org.uk"), "gmbl.org.uk");
  assert.equal(parseTarget("hello there").kind, "unknown");
});

test("a page of unknowns is never a clean result", () => {
  assert.equal(verdictOf([{ rule: "x", result: "unknown", detail: "", source: "s", why: "w" }]), "UNKNOWN");
  assert.equal(verdictOf([{ rule: "x", result: "info", detail: "", source: "s", why: "w" }]), "UNKNOWN");
});
