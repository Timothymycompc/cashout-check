// Records real cases for the tests: every web, registry and blockchain answer a check sees is saved, so the tests
// replay exactly what was live on the day. npm run record            (all cases in tests/cases.ts)
//                                         npm run record -- <id>     (one case)
import path from "path";
import { recordingNet } from "../server/net";
import { runCheck } from "../server/check";
import { CASES } from "../tests/cases";

(async () => {
  const only = process.argv[2];
  for (const c of CASES.filter((x) => !only || x.id === only)) {
    const { net, save } = recordingNet();
    const at = Date.now();
    const r = await runCheck(net, c.input, at);
    save(path.join("tests/fixtures", `${c.id}.json`), { id: c.id, input: c.input, recorded_at: new Date(at).toISOString() });
    console.log(`${c.id.padEnd(28)} ${r.verdict.padEnd(15)} expected ${c.expect}${r.verdict === c.expect ? "" : "   <-- differs"}`);
  }
})();
