// Checks a Telegram game bot or channel from Telegram's public pages (t.me/<name> and t.me/s/<name>).
import type { Net } from "../net";
import type { Finding } from "./types";
import { caseById, KNOWN_TELEGRAM } from "./known";

const text = (html: string, cls: string) => html.match(new RegExp(`class="${cls}(?: [^"]*)?"[^>]*>([\\s\\S]*?)</div>`))?.[1]
  ?.replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim() ?? null;
// "24 615 monthly users", "98.3K subscribers", "813K" -> numbers.
export function count(s: string | null | undefined): number | null {
  const m = s?.replace(/\s/g, "").match(/([\d.,]+)([KM]?)/i);
  if (!m) return null;
  return Math.round(Number(m[1].replace(/,/g, "")) * (m[2].toUpperCase() === "K" ? 1e3 : m[2].toUpperCase() === "M" ? 1e6 : 1));
}

// Promises of earnings: Prog Coin's bot says "Play & Earn" and "$PROG soon"; its channel promises an airdrop "soon".
const EARN = /\b(play\s*(?:&|and|to)\s*earn|p2e|earn (?:crypto|tokens?|usdt|money|gems)|mine|mining|airdrop|tap to earn|withdraw)/i;
const TOKEN_SOON = /\$[A-Z]{2,10}\s+(?:is\s+)?(?:coming\s+)?soon|token (?:launch|listing) soon|airdrop (?:is )?soon/i;

export async function checkTelegram(net: Net, username: string) {
  const findings: Finding[] = [];
  const facts: Record<string, unknown> = { username };
  const knownId = KNOWN_TELEGRAM[username.toLowerCase()];
  const known = knownId ? caseById(knownId) : null;
  if (known) findings.push({ rule: "known_case", result: "fail", detail: `@${username} is part of a case we investigated: ${known.name} (${known.checked}). ${known.summary}`, source: `CashOut Check case file: ${known.evidence}`, why: "We investigated it ourselves and kept the evidence." });

  const page = await net.get(`https://t.me/${username}`);
  if (page.status !== 200 || !/tgme_page_title/.test(page.text)) {
    findings.push({ rule: "telegram_page", result: "unknown", detail: `Telegram's public page for @${username} didn't load or doesn't exist.`, source: `https://t.me/${username}`, why: "Can't check what we can't load." });
    return { findings, facts };
  }
  const title = text(page.text, "tgme_page_title"), about = text(page.text, "tgme_page_description") ?? "", extra = text(page.text, "tgme_page_extra") ?? "";
  const isBot = /monthly users/i.test(extra) || /bot$/i.test(username);
  Object.assign(facts, { title, about, type: isBot ? "bot" : "channel", audience: extra });
  const source = `https://t.me/${username}`;

  if (EARN.test(about) && TOKEN_SOON.test(about)) findings.push({ rule: "earn_from_nothing", result: "warn", detail: `It promises earnings ("${about.match(EARN)![0]}") from a token that doesn't exist yet ("${about.match(TOKEN_SOON)![0]}"). Until a token exists and can be sold, the balance in the game can't be cashed out.`, source, why: "Prog Coin's bot says 'Play & Earn' and '$PROG soon'; its in-game balance was only a number kept on the player's phone." });
  else if (EARN.test(about)) findings.push({ rule: "earn_promise", result: "info", detail: `It promises earnings ("${about.match(EARN)![0]}"). Ask what you'd be paid in, and whether anyone has really cashed out.`, source, why: "Play-and-earn games we checked paid in points that couldn't be sold." });

  const links = [...new Set([...about.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase()))].filter((h) => !/(^|\.)t\.me$|telegram\.(org|me)$/.test(h));
  facts.websites = links;
  if (!links.length && EARN.test(about)) findings.push({ rule: "no_website", result: "info", detail: "It links to no website of its own, only to Telegram. There's no company, team or whitepaper to check.", source, why: "Prog Coin had no website, team or token." });

  // A channel's posts: very few posts with views far above its subscriber count is what bought views look like.
  if (!isBot) {
    const feed = await net.get(`https://t.me/s/${username}`);
    if (feed.status === 200) {
      const posts = (feed.text.match(/class="tgme_widget_message_wrap/g) ?? []).length;
      const views = [...feed.text.matchAll(/class="tgme_widget_message_views">([^<]+)</g)].map((m) => count(m[1]) ?? 0);
      const subs = count(extra);
      Object.assign(facts, { posts_shown: posts, top_post_views: views.length ? Math.max(...views) : null, subscribers: subs });
      if (subs && views.length && posts <= 10 && Math.max(...views) > subs * 4) findings.push({ rule: "inflated_views", result: "warn", detail: `Only ${posts} post${posts === 1 ? "" : "s"}, yet one shows ${Math.max(...views).toLocaleString("en-US")} views for ${subs.toLocaleString("en-US")} subscribers. Views can be bought to make a channel look popular.`, source: `https://t.me/s/${username}`, why: "Prog Coin's channel had 2 posts and 813K views on 98.3K subscribers." });
    }
  }
  findings.push({ rule: "game_site", result: "info", detail: "Telegram's public page doesn't show which website a bot's game runs on. That needs the app open on a phone (a traffic capture).", source, why: "Prog Coin's game ran on torncrypto.com, which only a capture showed." });
  if (!known) findings.push({ rule: "known_case", result: "pass", detail: "Not one of the bots or channels we've investigated.", source: "CashOut Check case files", why: "Checked against every case on record." });
  return { findings, facts };
}
