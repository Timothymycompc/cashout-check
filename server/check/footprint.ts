// Who is behind a site, as far as public data shows: where its server is, other sites on the same server, the social
// profiles and company it names, and its ad-tracking IDs (one advertiser's ID on many casinos ties them together:
// all 45 luckquexa sites carried the same 4 Facebook and 4 TikTok pixel IDs). Facts, not verdicts.
import type { Net } from "../net";
import { registrable } from "./input";

export async function hosting(net: Net, host: string) {
  const dns = await net.get(`https://dns.google/resolve?name=${host}&type=A`);
  let ips: string[] = [];
  try { ips = (JSON.parse(dns.text).Answer ?? []).filter((a: any) => a.type === 1).map((a: any) => a.data); } catch { /* none */ }
  if (!ips.length) return null;
  const info = await net.get(`https://ipinfo.io/${ips[0]}/json`);
  let d: any = {};
  try { d = JSON.parse(info.text); } catch { /* unknown owner */ }
  const org: string = d.org ?? "unknown owner";
  // A shared front (Cloudflare and other CDNs) hides the real server: thousands of unrelated sites share its addresses.
  const front = /cloudflare|akamai|fastly|incapsula|imperva|sucuri|stormwall|ddos-guard/i.test(org) || /cloudfront\.net$/i.test(d.hostname ?? "");
  return { ips, org, place: [d.city, d.region, d.country].filter(Boolean).join(", ") || null, hostname: d.hostname ?? null, front, source: "Google DNS and ipinfo.io" };
}

// Other sites on the same server. Only asked when the server is the site's own (not a shared front); a shared web host
// can still list unrelated neighbours, so the answer says "on the same server", never "the same owner".
export async function sameServer(net: Net, ip: string, self: string) {
  const r = await net.get(`https://api.hackertarget.com/reverseiplookup/?q=${ip}`);
  if (r.status !== 200 || /error|API count|No DNS/i.test(r.text.slice(0, 80))) return null;
  const domains = [...new Set(r.text.split("\n").map((h) => h.trim().toLowerCase()).filter((h) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h) && !/amazonaws\.com$|compute\.internal$/.test(h)).map(registrable))]
    .filter((d) => d !== self);
  return { domains: domains.slice(0, 30), total: domains.length, source: "HackerTarget reverse IP lookup" };
}

const SOCIAL: [string, RegExp][] = [
  ["Telegram", /https?:\/\/(?:t\.me|telegram\.me)\/(?!share\b|joinchat\b)(\+?[A-Za-z0-9_]{4,64})/gi],
  ["Discord", /https?:\/\/(?:discord\.gg|discord\.com\/invite)\/([A-Za-z0-9-]{2,32})/gi],
  ["X", /https?:\/\/(?:x|twitter)\.com\/(?!intent\b|share\b|home\b)([A-Za-z0-9_]{2,15})\b/gi],
  ["Facebook", /https?:\/\/(?:www\.|m\.)?facebook\.com\/(?!sharer|tr\b|tr\?|dialog|plugins|share)([A-Za-z0-9.-]{3,60})/gi],
  ["Instagram", /https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9_.]{2,30})/gi],
  ["TikTok", /https?:\/\/(?:www\.)?tiktok\.com\/@([A-Za-z0-9_.]{2,30})/gi],
  ["YouTube", /https?:\/\/(?:www\.)?youtube\.com\/(@[A-Za-z0-9_.-]{2,40}|channel\/[A-Za-z0-9_-]{10,})/gi],
  ["WhatsApp", /https?:\/\/wa\.me\/(\d{6,15})/gi],
  ["GitHub", /https?:\/\/github\.com\/([A-Za-z0-9-]{2,39})(?:\/[A-Za-z0-9_.-]+)?/gi],
];
// Libraries every web app bundles: their GitHub links say nothing about who runs the site.
const LIBRARY_GITHUB = /^(axios|facebook|zloirock|vuejs|reactjs|babel|lodash|jquery|twbs|necolas|feross|sindresorhus|webpack|vitejs|microsoft|google|mozilla|nodejs|npm|isaacs|ljharb|inspect-js|browserify|substack|emotion-js|mui|tailwindlabs|getsentry|paulmillr|moment|date-fns|chartjs|ethers-io|solana-labs|ton-org|tonkeeper)$/i;

export function socialProfiles(text: string) {
  const out: { site: string; profile: string }[] = [];
  for (const [site, re] of SOCIAL) {
    for (const m of text.matchAll(re)) {
      if (site === "GitHub" && LIBRARY_GITHUB.test(m[1])) continue;
      const profile = m[0].replace(/[),.'"]+$/, "");
      if (!out.some((o) => o.profile.toLowerCase() === profile.toLowerCase())) out.push({ site, profile });
    }
  }
  return out.slice(0, 15);
}

// Ad-tracking IDs: Facebook (Meta) pixel, TikTok pixel, Google tags.
export function adTrackers(text: string) {
  const ids = new Set<string>();
  for (const m of text.matchAll(/facebook\.com\/tr\?id=(\d{10,20})|fbq\(\s*['"]init['"]\s*,\s*['"](\d{10,20})/g)) ids.add(`Facebook ${m[1] ?? m[2]}`);
  for (const m of text.matchAll(/ttq\.load\(\s*['"]([A-Z0-9]{16,24})['"]/g)) ids.add(`TikTok ${m[1]}`);
  for (const m of text.matchAll(/\b(G-[A-Z0-9]{8,12}|GTM-[A-Z0-9]{5,8}|AW-\d{9,11})\b/g)) ids.add(`Google ${m[1]}`);
  // Config files list them as arrays: luckquexa's /api/site-config has "fbPixelIds":[...] and "ttPixelIds":[...].
  for (const m of text.matchAll(/"(?:fb|facebook|meta)Pixel(?:Ids?)?"\s*:\s*(\[[^\]]*\]|"[^"]*")/gi)) for (const id of m[1].match(/\d{12,20}/g) ?? []) ids.add(`Facebook ${id}`);
  for (const m of text.matchAll(/"(?:tt|tiktok)Pixel(?:Ids?)?"\s*:\s*(\[[^\]]*\]|"[^"]*")/gi)) for (const id of m[1].match(/[A-Z0-9]{18,24}/g) ?? []) ids.add(`TikTok ${id}`);
  return [...ids].slice(0, 20);
}

// The company a site says runs it ("New Era B.V."), from the visible text.
export function companyClaims(visible: string) {
  const re = /\b((?:[A-Z][A-Za-z0-9&'-]*\s){0,4}[A-Z][A-Za-z0-9&'-]*\s(?:B\.V\.|N\.V\.|Ltd\.?|Limited|LLC|L\.L\.C\.|Inc\.|S\.R\.L\.|GmbH|Pty Ltd|S\.A\.))/g;
  return [...new Set([...visible.matchAll(re)].map((m) => m[1].trim()))].filter((c) => !/^(The|All|Copyright|Powered)\b/.test(c)).slice(0, 5);
}
