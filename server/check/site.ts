// Checks a casino or game website. Each rule below is one of the tricks we found in a real case.
import type { Net } from "../net";
import type { Finding, Memory } from "./types";
import { caseForAddress, caseForDomain, caseForLicense, caseForTracker } from "./known";
import { adTrackers, companyClaims, hosting, sameServer, socialProfiles } from "./footprint";
import { cashoutRules, CONNECT_WALLET, limits, paymentMethods, withdrawScheme } from "./cashout";

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
  /withdrawal (?:activation|unlock(?:ing)?) (?:fee|deposit|payment)/i,
  /(?:compliance|verification|activation|insurance|security) deposit (?:of )?\$?\d/i, /deposit of \$\d[\d,.]* or more\. once the deposit is credited[^.]*withdraw/i, /pay (?:a |the )?(?:tax|fee) (?:to|before you can) withdraw/i];
// Withdrawals tied to new deposits: highcash7's "Withdrawal Rules" say "Each time you deposit, you can transfer out
// 10% ~ 100% of the deposit amount" and "Deposit any amount to become VIP and withdraw cash". Tim deposited there and
// did cash out, so this is not the endless pay-to-unlock chain: it's a limit tied to depositing again.
// The share-per-deposit sentence says the most, so it's quoted first when a site has both.
const WITHDRAW_TIED = [/each time you deposit,? you can (?:transfer|withdraw|cash) out \d+\s?%(?:\s?~\s?\d+\s?%)? of (?:the |each |your )?deposit(?: amount)?/i,
  /deposit any amount (?:to|and) (?:become vip and )?(?:withdraw|cash ?out|receive your rewards in cash)[^."<]{0,40}/i];
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

export async function checkSite(net: Net, domain: string, url: string, now = Date.now(), memory?: Memory) {
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
  // Kits keep the site's settings, ad IDs included, in a config file the page loads (luckquexa: /api/site-config).
  const config = await net.get(`https://${host}/api/site-config`);
  const configText = isJson(config) ? config.text : "";
  // The kit's steps page lists each payment demanded when someone asks to withdraw: luckquexa's has 7, $80 to $2,000.
  let paySteps: { title: string; amount: number }[] = [];
  try { if (isJson(steps)) paySteps = (JSON.parse(steps.text).steps ?? []).filter((x: any) => typeof x.amount === "number").map((x: any) => ({ title: String(x.title ?? "step"), amount: x.amount })); } catch { /* not that kit */ }
  if (paySteps.length) {
    facts.withdraw_payment_steps = paySteps;
    const total = paySteps.reduce((n, x) => n + x.amount, 0);
    findings.push({ rule: "pay_to_withdraw", result: "fail", detail: `When you ask to withdraw, it demands ${paySteps.length} payments in a row before anything is paid out: ${paySteps.map((x) => `${x.title} $${x.amount.toLocaleString("en-US")}`).join(", ")}. That's $${total.toLocaleString("en-US")} in all, and each step leads to the next.`, source: `https://${host}/api/error-steps`, why: "Found in luckquexa's own code: the scripted list of 'verification' payments shown to anyone who tries to withdraw." });
  }
  if (isJson(siblings) || isJson(steps)) {
    const list = isJson(siblings) ? [...siblings.text.matchAll(/"([a-z0-9-]+\.[a-z.]{2,})"/gi)].map((m) => m[1]).slice(0, 60) : [];
    if (list.length) facts.sister_sites = list;
    findings.push({ rule: "scam_kit", result: "fail", detail: `This site answers ${[isJson(siblings) && "/api/domains/siblings", isJson(steps) && "/api/error-steps"].filter(Boolean).join(" and ")}, the hidden pages of the fake-casino kit behind the luckquexa network${list.length ? `, and lists ${list.length} sister sites` : ""}. In that kit, every withdrawal is answered with a chain of payments you have to make first.`, source: `https://${host}/api/domains/siblings, /api/error-steps`, why: "Found in luckquexa's own code: /api/error-steps holds the scripted pay-to-withdraw steps." });
  } else findings.push({ rule: "scam_kit", result: "pass", detail: "Doesn't run the hidden pages of the fake-casino kit behind the luckquexa network.", source: `https://${host}/api/domains/siblings, /api/error-steps`, why: "That kit runs 45+ fake casinos." });

  const trap = paySteps.length ? null : WITHDRAW_TRAP.find((re) => re.test(all));
  if (paySteps.length) { /* already reported, step by step */ }
  else if (trap) findings.push({ rule: "pay_to_withdraw", result: "fail", detail: `The site's own text says you have to pay before you can withdraw: "${all.match(trap)![0]}". Real casinos take a fee out of a withdrawal; they don't make you send more money to unlock it.`, source: url, why: "luckquexa coached players to 'make a deposit to unlock your withdrawal'; highcash7 lets you take out only a share of each new deposit." });
  else findings.push({ rule: "pay_to_withdraw", result: "pass", detail: "No chain of 'verification', 'tax' or 'VIP' payments demanded before a withdrawal.", source: url, why: "luckquexa demanded 7 payments, $4,624 in all, before any withdrawal." });

  const tied = WITHDRAW_TIED.map((re) => all.match(re)).find(Boolean);
  if (tied) findings.push({ rule: "withdrawal_tied_to_deposits", result: "warn", detail: `How much you can withdraw depends on depositing again: "${tied[0].trim()}". Winnings come out a share at a time, each share unlocked by a new deposit. A site like this can pay out, but plan on paying in before you can take money out, and count what you've paid in, not what the balance says.`, source: url, why: "highcash7's own withdrawal rules. A player who deposited there was able to cash out, so it's a limit, not the endless chain of payments luckquexa demands." });
  const gated = !trap && all.match(WITHDRAW_GATED);
  if (gated) findings.push({ rule: "withdrawal_locked", result: "warn", detail: `Withdrawals are locked until you finish something first: "${gated[0]}". Until then, the balance you see isn't money you can take out.`, source: url, why: "Prog Coin locks withdrawals behind 'Airdrop tasks' and 'Account Verification Tasks'." });

  const template = TEMPLATE.filter((re) => re.test(all)).map((re) => all.match(re)![0]);
  if (template.length) findings.push({ rule: "unfinished_template", result: "warn", detail: `The site still has placeholder text from a ready-made template: ${[...new Set(template)].slice(0, 3).map((t) => `"${t}"`).join(", ")}.`, source: url, why: "luckquexa showed 'Casino Casino' and support@casino.com; Prog Coin's domain shows 'Your Business, Launching Soon'." });
  else findings.push({ rule: "unfinished_template", result: "pass", detail: "No leftover template text.", source: url, why: "Throwaway scam sites are often unfinished templates." });

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
  else findings.push({ rule: "fake_game_studio", result: "pass", detail: "No games loaded from lookalikes of real game studios.", source: url, why: "Copied games can be set to never pay out." });

  // 6. Blocking people from inspecting the page (Prog Coin loads disable-devtool).
  if (/disable-devtool/i.test(all)) findings.push({ rule: "hides_its_code", result: "warn", detail: "The page loads disable-devtool, a script that stops people from looking at what the page does.", source: url, why: "Prog Coin's game loads it." });
  else findings.push({ rule: "hides_its_code", result: "pass", detail: "Doesn't block people from inspecting the page.", source: url, why: "Prog Coin's game blocks it." });

  // 7. Crypto addresses in the page's own code: fixed deposit wallets shared by every player (Prog Coin).
  const addresses = [...new Set(all.match(ADDRESS) ?? [])].slice(0, 20);
  if (addresses.length) facts.addresses_in_code = addresses;
  const knownAddr = addresses.map(caseForAddress).find(Boolean);
  if (knownAddr && !known) findings.push({ rule: "known_case", result: "fail", detail: `Its code pays into wallets from a case we investigated: ${knownAddr.name}.`, source: `${url} and CashOut Check case file: ${knownAddr.evidence}`, why: "Same wallets, same operator." });

  const server = await hosting(net, host);
  if (server) {
    Object.assign(facts, { server_ips: server.ips, server_owner: server.org, server_place: server.place });
    findings.push({ rule: "server", result: "info", detail: server.front
      ? `Hidden behind ${server.org.replace(/^AS\d+\s*/, "")}, which hides where the real server is.`
      : `Server: ${server.org.replace(/^AS\d+\s*/, "")}${server.place ? `, ${server.place}` : ""} (${server.ips[0]}).`, source: server.source, why: "Where a site is hosted is who a report goes to." });
    const sisters = server.front ? null : await sameServer(net, server.ips[0], domain);
    if (sisters?.domains.length) {
      facts.same_server = sisters.domains;
      findings.push({ rule: "sister_sites", result: "info", detail: `${sisters.total} other site${sisters.total === 1 ? "" : "s"} on the same server: ${sisters.domains.slice(0, 8).join(", ")}${sisters.total > 8 ? "…" : ""}. Near-identical names usually mean one operator running many brands.`, source: sisters.source, why: "The luckquexa operator ran 45 copies of one casino; when one is shut down, players are moved to the next." });
    }
  }
  // How cashing out works here, in the site's own words. Always shown: it's the question this check is named after.
  const methods = paymentMethods(all), rules = cashoutRules(all), caps = limits(all), scheme = withdrawScheme(rules, all);
  Object.assign(facts, { payment_methods: methods, cashout_rules: rules, cashout_limits: caps, withdraw_scheme: scheme });
  const q = (s: string | null) => (s ? `yes: "${s}"` : "not stated");
  findings.push({ rule: "how_cashout_works", result: "info", detail: rules.length || methods.length || caps.length || scheme.deposit_first
    ? [`The withdraw scheme, in its own words.`,
      `Deposit before you can withdraw? ${q(scheme.deposit_first)}.`,
      `Only part of your balance per deposit? ${q(scheme.share_per_deposit)}.`,
      `Paid out in steps? ${q(scheme.in_steps)}.`,
      `Things to do first: ${scheme.conditions.length ? scheme.conditions.join(", ") : "none stated"}.`,
      `Free or bonus winnings kept apart until you deposit? ${q(scheme.free_money_locked)}.`,
      `Fees or taxes on withdrawing: ${q(scheme.fees)}.`,
      `Limits: ${caps.length ? caps.join(", ") : "not stated"}.`,
      `Payment methods it mentions: ${methods.length ? methods.join(", ") : "none"}.`,
      ...(rules.length ? [`Its cash-out rules: ${rules.slice(0, 5).map((r) => `"${r}"`).join(" ")}`] : [])].join("\n")
    : "The site doesn't say how cashing out works, or only shows it after you sign up. Ask before you deposit: how you get paid, how fast, how much at a time, and what it costs.",
    source: url, why: "Every scam we checked made the cash-out the trap: pay first, or only a share of each new deposit." });
  if (scheme.free_money_locked) findings.push({ rule: "free_money_locked", result: "info", detail: `Winnings from free or bonus credits are kept apart from cash: "${scheme.free_money_locked}". If you've only played on free credits, expect those winnings to stay locked until you deposit. Money you deposit yourself is what can come out first.`, source: url, why: "highcash7 shows a separate 'Withdrawable Amount' and 'Free Winning Withdraw'; a player there found free-credit winnings stayed locked until they deposited." });
  if (CONNECT_WALLET.test(all)) findings.push({ rule: "connect_wallet", result: "warn", detail: "It asks you to connect a crypto wallet. A connected wallet can be asked to approve transactions that empty it; only connect a wallet holding nothing you can't lose.", source: url, why: "luckquexa pushed players to connect a wallet holding at least $200 to a lookalike payment page." });

  const company = companyClaims(visible);
  if (company.length) { facts.company = company; findings.push({ rule: "company", result: "info", detail: `Says it's run by: ${company.join(", ")}. Look the company up in its country's business register.`, source: url, why: "luckquexa named 'New Era B.V.', a company number copied from another fake casino." }); }
  const socials = socialProfiles(all);
  if (socials.length) { facts.social = socials; findings.push({ rule: "social_profiles", result: "info", detail: `Links to: ${socials.map((x) => `${x.site} ${x.profile.replace(/^https?:\/\//, "")}`).join(", ")}.`, source: url, why: "luckquexa's links led to x.com/gamevault_world, tying it to the GameVault apps." }); }
  // Ad-tracking IDs: always shown, because the same ID on two sites ties them to one advertiser.
  const trackers = adTrackers(all + "\n" + configText);
  facts.ad_trackers = trackers;
  const whyTrackers = "All 45 luckquexa sites carried the same Facebook and TikTok ad IDs: one advertiser behind all of them.";
  findings.push(trackers.length
    ? { rule: "ad_trackers", result: "info", detail: `Ad-tracking IDs: ${trackers.join(", ")}. The same ID on another site means the same advertiser.`, source: configText ? `${url} and its /api/site-config` : url, why: whyTrackers }
    : { rule: "ad_trackers", result: "info", detail: "No ad-tracking IDs in its page. Some sites only add them when you arrive from an ad.", source: url, why: whyTrackers });
  const trackerCase = trackers.map(caseForTracker).find(Boolean);
  if (trackerCase && !known) findings.push({ rule: "same_advertiser", result: "fail", detail: `It uses the same ad account as a case we investigated: ${trackerCase.name}. Same advertiser, same operator.`, source: `${url} and CashOut Check case file: ${trackerCase.evidence}`, why: whyTrackers });
  // The same IDs on the sister sites sharing its server.
  // Sisters: other sites on its own server, or the sister list a kit publishes (luckquexa's /api/domains/siblings).
  const sisterList = [...((facts.same_server as string[] | undefined) ?? []), ...((facts.sister_sites as string[] | undefined) ?? [])].filter((d) => d !== domain);
  const shared: string[] = [];
  for (const sister of [...new Set(sisterList)].slice(0, 4)) {
    if (!trackers.length) break;
    const r = await net.get(`https://${sister}/`, { timeoutMs: 10_000 });
    const c = configText ? await net.get(`https://${sister}/api/site-config`, { timeoutMs: 10_000 }) : null;
    const theirs = adTrackers((r.status === 200 ? r.text : "") + "\n" + (c && isJson(c) ? c.text : ""));
    const both = trackers.filter((t) => theirs.includes(t));
    if (both.length) shared.push(`${sister} (${both.join(", ")})`);
  }
  if (shared.length) { facts.same_advertiser_sites = shared; findings.push({ rule: "same_advertiser_sisters", result: "info", detail: `The same ad ID is on its sister site${shared.length === 1 ? "" : "s"}: ${shared.join("; ")}. One advertiser runs them.`, source: "the sister sites' own pages", why: whyTrackers }); }
  // And on sites people checked here before.
  if (memory && trackers.length) {
    const seen = await memory.sitesWithTrackers(trackers, domain).catch(() => ({} as Record<string, string[]>));
    const lines = Object.entries(seen).filter(([, sites]) => sites.length).map(([id, sites]) => `${id} also on ${sites.slice(0, 5).join(", ")}${sites.length > 5 ? "…" : ""}`);
    if (lines.length) findings.push({ rule: "same_advertiser_seen", result: "info", detail: `Seen before on other checked sites: ${lines.join("; ")}.`, source: "CashOut Check's earlier checks", why: whyTrackers });
    void memory.rememberTrackers(domain, trackers).catch(() => {});
  }
  findings.push(addresses.length
    ? { rule: "wallets_in_code", result: "info", detail: `Crypto wallets written into its code: ${addresses.slice(0, 4).join(", ")}${addresses.length > 4 ? "…" : ""}. Paste one here to see how much money it collects.`, source: url, why: "Prog Coin's game sent every player's payments to the same fixed wallets." }
    : { rule: "wallets_in_code", result: "pass", detail: "No crypto wallets written into its code.", source: url, why: "Prog Coin's game sent every player's payments to the same fixed wallets." });

  if (!known) findings.push({ rule: "known_case", result: "pass", detail: "Not one of the scam sites we've investigated.", source: "CashOut Check case files", why: "Checked against every case on record." });
  facts.looks_like_gambling = gambling;
  return { findings, facts };
}
