// Runs one live check and prints it: npm run check -- <link, @bot or wallet>
import { liveNet } from "../server/net";
import { runCheck } from "../server/check";

const ICON = { fail: "❌", warn: "⚠️", info: "ℹ️", pass: "✅", unknown: "❔" } as const;
(async () => {
  const input = process.argv.slice(2).join(" ");
  if (!input) throw new Error("Usage: npm run check -- <casino link, t.me/bot or wallet address>");
  const r = await runCheck(liveNet, input);
  console.log(`\n${r.verdict}: ${r.headline}\n`);
  for (const f of r.findings) console.log(`${ICON[f.result]} ${f.rule}: ${f.detail}\n     source: ${f.source}`);
  console.log(`\nfacts: ${JSON.stringify(r.facts)}`);
})();
