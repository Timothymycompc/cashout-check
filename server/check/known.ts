// Cases we investigated by hand, with the evidence on record. A match here is a fact ("this domain is one of the 45
// luckquexa sites, investigated 2026-10-21"), not a guess. Add a case only with its evidence file.
export type KnownCase = {
  id: string; name: string; checked: string; summary: string; evidence: string;
  domains: string[]; addresses: string[]; licenses: string[];
  // Ad-tracking IDs, as adTrackers() writes them ("Facebook 947543307877053").
  trackers?: string[];
};

export const KNOWN_CASES: KnownCase[] = [
  {
    id: "luckquexa-network",
    name: "luckquexa network of fake crypto casinos",
    checked: "2026-10-21",
    summary: "45 near-identical crypto casinos run by one operation: fake winnings, then a chain of 'verification' payments before any withdrawal, ID and card collection, and a lookalike payment page.",
    evidence: "luckquexa-investigation-2026-10-21.txt (the site's own /api/domains/siblings and /api/error-steps, RDAP, LCB.org)",
    domains: [
      "eagleplay.casino", "eagleplay.win", "eaglestrike.bet", "crimsonvaultcasino.com", "goldentidecasino.com", "noirwheel.com",
      "reelquake.com", "spinmelo.com", "spinolix.com", "betglimera.com", "betnesta.com", "casizonix.com", "reelquaka.com",
      "spinolya.com", "spinolyx.com", "betglimmex.com", "betnestix.com", "casizonex.com", "jacknestix.com", "luckquexa.com",
      "reelflara.com", "reelquakka.com", "spinolyra.com", "spinorixa.com", "spinquexa.com", "betglora.com", "betnestya.com",
      "betolyra.com", "betquexa.com", "betzenx.com", "jackglimm.com", "jackolyra.com", "jackquexa.com", "jackspina.com",
      "luckblaza.com", "luckflara.com", "lucknestix.com", "reelcozyx.com", "reelnestix.com", "reelquexa.com", "reelzyx.com",
      "spinhavex.com", "spinmira.com", "spinorayx.com", "spinquelx.com",
      // Its lookalike payment pages and fake review site.
      "heleket-payment.club", "heleket-payment.cfd", "trustpillot.io",
      // Where its slot games were really served from (not the game studios).
      "gmmm.click", "global2api.org", "zcpvnfkadooapd.co.in", "gmbl.org.uk",
    ],
    addresses: [],
    licenses: ["OGL/2024/181", "157707"],
    // From its /api/site-config (2026-10-21; the fifth Facebook ID appeared there by 2026-10-23).
    trackers: ["Facebook 947543307877053", "Facebook 3495227700659111", "Facebook 1486415666644303", "Facebook 2378337426033000", "Facebook 1148417647539184",
      "TikTok DB6COQBC77UDJT302D70", "TikTok DB806L3C77UD150JCCPG", "TikTok DBAVLMRC77U1UMSUN870", "TikTok DBBLSHJC77U4SEFNDIVG",
      "TikTok DAMQTLRC77UFS4KR3U5G", "TikTok DAN53D3C77UFS4KR41AG", "TikTok DAMR3J3C77UCJD1NR280"],
  },
  {
    id: "prog-coin",
    name: "Prog Coin (Telegram play-and-earn game)",
    checked: "2026-10-22",
    summary: "A Telegram 'play and earn' game whose balance exists only on the player's phone, with no token or company behind it, that sells boosts for crypto paid to shared wallets.",
    evidence: "progcoin-investigation-2026-10-22.txt (phone capture, the game's own JavaScript, RDAP, public blockchain data)",
    domains: ["torncrypto.com", "crypto-apps.center"],
    addresses: [
      "Euxd1pSXmJHEsdVXwk2H8gaEKbbNyBmgB1Gt2NdqHsA9", "TQVcax5B3fHtyVKafq9K6VZkWZSKd14SfY",
      "UQDl4k0rqIwvYxhP_fIx5y0SOZmdCLINVE1yQ2oTkillf7hC", "0x5b51500f0617ca816Bc66F311937798DA5E2fFCD",
      "bc1qhnh67rhe5vcc28q3sxkrjzwcapj8qlms078cve", "ltc1qca8wmha7cvr72zcprx24xxp06vnhz8s6std65j",
      "DRLoM2dHuuegLTJaRN9YWUfqMysvomEXry", "raruLFSyj4ppi9Uc2K7MNrQBs7xKaMbgRS", "qrg4du5qt7n2m0uekctv2rpk7leps5k9aqrpypyp2a",
      "0x2de284e78a90df5ba564f45f0e522c17862aa1940d9488cdf1c4d22b505511da",
    ],
    licenses: [],
  },
];

// Telegram usernames tied to a case, lowercase.
export const KNOWN_TELEGRAM: Record<string, string> = { progcoinbot: "prog-coin", progcoinofficial: "prog-coin" };

const byDomain = new Map(KNOWN_CASES.flatMap((c) => c.domains.map((d) => [d, c] as const)));
const byAddress = new Map(KNOWN_CASES.flatMap((c) => c.addresses.map((a) => [a.toLowerCase(), c] as const)));
export const caseForDomain = (domain: string) => byDomain.get(domain.toLowerCase()) ?? null;
export const caseForAddress = (address: string) => byAddress.get(address.toLowerCase()) ?? null;
const byTracker = new Map(KNOWN_CASES.flatMap((c) => (c.trackers ?? []).map((t) => [t, c] as const)));
export const caseForTracker = (id: string) => byTracker.get(id) ?? null;
export const caseById = (id: string) => KNOWN_CASES.find((c) => c.id === id) ?? null;
export const caseForLicense = (text: string) =>
  KNOWN_CASES.find((c) => c.licenses.some((l) => new RegExp(`(^|[^0-9A-Za-z])${l.replace(/[/]/g, "\\/")}([^0-9]|$)`).test(text))) ?? null;
