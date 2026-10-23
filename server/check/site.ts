// Checks a casino or game website. Each rule below is one of the tricks we found in a real case.
import type { Net } from "../net";
import type { Finding } from "./types";
import { caseForAddress, caseForDomain, caseForLicense } from "./known";

const DAY = 86_400_000;
const daysSince = (iso: string, now: number) => Math.floor((now - Date.parse(iso)) / DAY);

// Domain registries answer through RDAP; IANA's list says which server answers for each ending (.com, .vip...).
async function rdapServer(net: Net, tld: string): Promise<string | null> {
  const r = await net.get("https://data.iana.org/rdap/dns.json");
  if (r.status !== 200) return null;
  try {
    const services: [string[], string[]][] = JSON.parse(r.text).services;
    const hit = services.find(([tlds]) => tlds.includes(tld));
    return hit ? hit[1][0].replace(/\/?$/, "/") : null;
  } catch { return null; }
}

export async function registration(net: Net, domain: string) {
  const server = await rdapServer(net, domain.split(".").pop()!);
  if (!server) return null;
  const r = await net.get(`${server}domain/${domain}`, { headers: { accept: "application/rdap+json" } });
  if (r.status !== 200) return null;
  try {
    const d = JSON.parse(r.text);
    const when = (a: string) => d.events?.find((e: any) => e.eventAction === a)?.eventDate ?? null;
    const registrar = d.entities?.find((e: any) => e.roles?.includes("registrar"));
    const name = registrar?.vcardArray?.[1]?.find((x: any) => x[0] === "fn")?.[3] ?? null;
    return { registered: when("registration"), expires: when("expiration"), registrar: name, nameservers: (d.nameservers ?? []).map((n: any) => String(n.ldhName).toLowerCase()), source: `RDAP (${new URL(server).host})` };
  } catch { return null; }
}

// Words a casino or earn-game page uses; a page with none of them isn't judged on gambling-licence rules.
const GAMBLING = /\b(casino|slots?|jackpot|roulette|blackjack|poker|bet(ting)?|sportsbook|spins?|deposit bonus|play (?:&|and) earn|earn gems)\b/i;
// Unfinished template text, seen on luckquexa ("Casino Casino", support@casino.com, "{brand}" in its reviews) and on
// crypto-apps.center behind Prog Coin ("Your Business", "Launching Soon").
const TEMPLATE = [/\bYour Business\b/, /\bLaunching Soon\b/i, /[a-z]+@casino\.com\b/i, /\{brand\}/, /\bCasino Casino\b/, /\blorem ipsum\b/i];
// The pay-to-withdraw trap in luckquexa's own reviews and FAQ: "you do have to make a deposit to unlock your withdrawal".
const WITHDRAW_TRAP = [/deposit (?:to|before you can|in order to) (?:unlock|activate|release|process) (?:your |the )?withdrawal/i,
  /withdrawal (?:activation|unlock(?:ing)?) (?:fee|deposit|payment)/i, /pay (?:a |the )?(?:tax|fee) (?:to|before you can) withdraw/i];
// Withdrawals locked behind "tasks" or "verification" first. Prog Coin's FAQ: "How do I unlock withdrawals? Complete all
// required Airdrop tasks" / "Account Verification Tasks". Not proof of a payment trap, but the money isn't yours to take.
const WITHDRAW_GATED = /how (?:do|can) i unlock withdrawals?|withdrawals? (?:are|is) (?:locked|unlocked (?:after|when|once))|complete (?:all )?(?:the )?(?:required )?[a-z ]{0,30}tasks?[^.]{0,40}withdraw/i;
// Licence claims on casino pages. OGL/... is Curaçao's new numbering; luckquexa's was copied from a flagged casino.
const LICENSE = /\b(OGL\/\d{4}\/\d+(?:\/\d+)?|\d{3,5}\/JAZ|Cura[cç]ao(?:\s+e-?Gaming|\s+Gaming)?|Anjouan|Malta Gaming Authority|MGA\/[A-Z0-9/]+|Kahnawake|UK Gambling Commission)/gi;
// Real game studios. A page that loads games from a lookalike of these names is not getting them from the studio
// (Boomwins: pp.pragmaticsplaygames.com and api-usa.pgf-games.com).
const STUDIOS: { name: string; word: RegExp; real: RegExp }[] = [
  { name: "Pragmatic Play", word: /pragmatic/i, real: /(^|\.)pragmaticplay\.(net|com)$/i },
  { name: "PG Soft", word: /(^|[.-])pg-?(soft|f)(-games)?\./i, real: /(^|\.)pgsoft\.com$/i },
  { name: "Evolution", word: /evolution(gaming)?/i, real: /(^|\.)evolution\.com$/i },
  { name: "NetEnt", word: /netent/i, real: /(^|\.)netent\.com$/i },
];
const ADDRESS = /\b(0x[a-fA-F0-9]{40}|T[1-9A-HJ-NP-Za-km-z]{33}|(?:EQ|UQ)[A-Za-z0-9_-]{46}|bc1[a-z0-9]{25,62})\b/g;

const decode = (s: string) => s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function hostsIn(html: string): string[] {
  return [...new Set([...html.matchAll(/(?:src|href)=["'](?:https?:)?\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase()))];
}

export async function checkSite(net: Net, domain: string, url: string, now = Date.now()) {
  const findings: Finding[] = [];
  const facts: Record<string, unknown> = { domain };

  const known = caseForDomain(domain);
  if (known) findings.push({ rule: "known_case", result: "fail", detail: `${domain} is part of a case we investigated: ${known.name} (${known.checked}). ${known.summary}`, source: `CashOut Check case file: ${known.evidence}`, why: "We investigated it ourselves and kept the evidence." });

  // 1. How new the domain is. luckquexa was registered 2026-09-13 and found 38 days later; its 44 sisters were made in
  //    batches over four months. Scam casinos are thrown away and replaced, so most are only weeks or months old.
  const reg = await registration(net, domain);
  if (reg?.registered) {
    const age = daysSince(reg.registered, now);
    Object.assign(facts, { registered: reg.registered.slice(0, 10), registrar: reg.registrar, nameservers: reg.nameservers, domain_age_days: age });
    const line = `${domain} was registered on ${reg.registered.slice(0, 10)} at ${reg.registrar ?? "an unnamed registrar"}, ${age} days ago.`;
    findings.push(age < 180
      ? { rule: "domain_age", result: "warn", detail: `${line} Brand-new casino and game sites are the usual sign of a throwaway scam site.`, source: reg.source, why: "The luckquexa network registered 45 casinos in batches between May and September 2026." }
      : { rule: "domain_age", result: "pass", detail: line, source: reg.source, why: "Scam casinos rarely keep one domain for long." });
  } else {
    findings.push({ rule: "domain_age", result: "unknown", detail: "The domain registry didn't say when it was registered.", source: "RDAP", why: "Domain age is the first sign of a throwaway site." });
  }

  // 2. The page itself, plus the scripts it loads from its own host (many scam casinos draw everything with JavaScript).
  const page = await net.get(url);
  facts.page_status = page.status;
  if (page.status === 0 || page.status >= 500) {
    findings.push({ rule: "site_reachable", result: "unknown", detail: `The site didn't answer (${page.status || page.text}).`, source: url, why: "Can't check what we can't load." });
    return { findings, facts };
  }
  const title = decode(page.text.match(/<title[^>]*>([^<]{0,120})/i)?.[1]?.trim() ?? "") || null;
  facts.title = title;
  const host = new URL(page.url).hostname;
  const scripts = [...page.text.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => new URL(m[1], page.url))
    .filter((u) => u.hostname === host).slice(0, 8);
  const bodies = [page.text];
  for (const s of scripts) { const r = await net.get(s.toString(), { timeoutMs: 15_000 }); if (r.status === 200) bodies.push(r.text); }
  const all = bodies.join("\n");
  const visible = page.text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  // Only the words a visitor sees: program code is full of "bet", "spin" and "slot" on any site.
  const gambling = GAMBLING.test(visible) || GAMBLING.test(title ?? "");

  // 3. The luckquexa kit's hidden addresses: a sister-site list (so players follow it when a domain is shut down) and the
  //    scripted "steps" of payments shown when someone tries to withdraw. Any site answering both runs the same kit.
  const siblings = await net.get(`https://${host}/api/domains/siblings`);
  const steps = await net.get(`https://${host}/api/error-steps`);
  const isJson = (r: { status: number; text: string }) => r.status === 200 && /^\s*[[{]/.test(r.text);
  if (isJson(siblings) || isJson(steps)) {
    const list = isJson(siblings) ? [...siblings.text.matchAll(/"([a-z0-9-]+\.[a-z.]{2,})"/gi)].map((m) => m[1]).slice(0, 60) : [];
    if (list.length) facts.sister_sites = list;
    findings.push({ rule: "scam_kit", result: "fail", detail: `This site answers ${[isJson(siblings) && "/api/domains/siblings", isJson(steps) && "/api/error-steps"].filter(Boolean).join(" and ")}, the hidden pages of the fake-casino kit behind the luckquexa network${list.length ? `, and lists ${list.length} sister sites` : ""}. In that kit, every withdrawal is answered with a chain of payments you have to make first.`, source: `https://${host}/api/domains/siblings, /api/error-steps`, why: "Found in luckquexa's own code: /api/error-steps holds the scripted pay-to-withdraw steps." });
  }

  const trap = WITHDRAW_TRAP.find((re) => re.test(all));
  if (trap) findings.push({ rule: "pay_to_withdraw", result: "fail", detail: `The site's own text says you have to pay before you can withdraw: "${all.match(trap)![0]}". Real casinos take a fee out of a withdrawal; they don't make you send more money to unlock it.`, source: url, why: "luckquexa's FAQ and fake reviews coached players to 'make a deposit to unlock your withdrawal'." });

  const gated = !trap && all.match(WITHDRAW_GATED);
  if (gated) findings.push({ rule: "withdrawal_locked", result: "warn", detail: `Withdrawals are locked until you finish something first: "${gated[0]}". Until then, the balance you see isn't money you can take out.`, source: url, why: "Prog Coin locks withdrawals behind 'Airdrop tasks' and 'Account Verification Tasks'." });

  const template = TEMPLATE.filter((re) => re.test(all)).map((re) => all.match(re)![0]);
  if (template.length) findings.push({ rule: "unfinished_template", result: "warn", detail: `The site still has placeholder text from a ready-made template: ${[...new Set(template)].slice(0, 3).map((t) => `"${t}"`).join(", ")}.`, source: url, why: "luckquexa showed 'Casino Casino' and support@casino.com; Prog Coin's domain shows 'Your Business, Launching Soon'." });

  // 4. Licence claims.
  const claims = [...new Set([...visible.matchAll(LICENSE)].map((m) => m[0]))];
  const copied = caseForLicense(visible);
  if (copied) findings.push({ rule: "license", result: "fail", detail: `It shows a licence number we've seen copied onto fake casinos (${copied.licenses.join(", ")}, in the ${copied.name}).`, source: `${url} and CashOut Check case file: ${copied.evidence}`, why: "luckquexa's licence was copied from eaglequest.vip, which LCB.org found unlicensed." });
  else if (claims.length) findings.push({ rule: "license", result: "info", detail: `It claims a licence: ${claims.slice(0, 3).join(", ")}. We can't confirm it from here; look the number up on the regulator's own website, not through a link on the casino's page.`, source: url, why: "luckquexa's 'licence' link went to a general register page that didn't mention it." });
  // Only a note: big licensed operators often show their licence in a footer drawn by scripts, and none of our cases
  // were caught by a missing licence (luckquexa faked one instead).
  else if (gambling) findings.push({ rule: "license", result: "info", detail: "We didn't find a gambling licence on its front page. A real online casino says who licenses it; check that on the regulator's own website.", source: url, why: "A licence is what lets you complain to someone when a casino won't pay." });

  // 5. Games served from lookalikes of real studios' names.
  const hosts = hostsIn(all);
  const fakes = STUDIOS.flatMap((s) => hosts.filter((h) => s.word.test(h) && !s.real.test(h)).map((h) => `${h} (not ${s.name})`));
  if (fakes.length) findings.push({ rule: "fake_game_studio", result: "warn", detail: `Its games load from addresses made to look like real game studios: ${fakes.slice(0, 3).join(", ")}. Copied games can be set to never pay out.`, source: url, why: "Boomwins loaded 'Pragmatic Play' games from pp.pragmaticsplaygames.com and PG Soft games from pgf-games.com." });

  // 6. Blocking people from inspecting the page (Prog Coin loads disable-devtool).
  if (/disable-devtool/i.test(all)) findings.push({ rule: "hides_its_code", result: "warn", detail: "The page loads disable-devtool, a script that stops people from looking at what the page does.", source: url, why: "Prog Coin's game loads it." });

  // 7. Crypto addresses in the page's own code: fixed deposit wallets shared by every player (Prog Coin).
  const addresses = [...new Set(all.match(ADDRESS) ?? [])].slice(0, 20);
  if (addresses.length) facts.addresses_in_code = addresses;
  const knownAddr = addresses.map(caseForAddress).find(Boolean);
  if (knownAddr && !known) findings.push({ rule: "known_case", result: "fail", detail: `Its code pays into wallets from a case we investigated: ${knownAddr.name}.`, source: `${url} and CashOut Check case file: ${knownAddr.evidence}`, why: "Same wallets, same operator." });

  if (!known) findings.push({ rule: "known_case", result: "pass", detail: "Not one of the scam sites we've investigated.", source: "CashOut Check case files", why: "Checked against every case on record." });
  facts.looks_like_gambling = gambling;
  return { findings, facts };
}
