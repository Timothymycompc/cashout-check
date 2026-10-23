// How cashing out works on a site, in its own words: the payment methods it mentions, its minimums and maximums, and its
// withdrawal rules quoted as written. Facts first; the rules that judge them are in site.ts.

// Payment methods, as sites name them in text and in icon file names (highcash7 ships icon_cashapp.png, icon_paypal.png).
const METHODS: [string, RegExp][] = [
  ["Cash App", /cash\s?app|\$cashtag|icon_cashapp/i], ["PayPal", /paypal/i], ["Venmo", /venmo/i], ["Zelle", /zelle/i], ["Chime", /\bchime\b/i],
  ["bank card", /bank\s?card|visa|mastercard|debit card|credit card/i], ["bank transfer", /bank transfer|wire transfer|\bACH\b/i],
  ["PIX (Brazil)", /\bpix\b/i], ["Apple Pay", /apple\s?pay/i], ["Google Pay", /google\s?pay|\bgpay\b/i],
  ["gift cards", /gift\s?cards?\b/i], // Not the bare word "crypto": every web page's code uses the browser's built-in crypto feature.
  ["crypto", /\b(bitcoin|btc|usdt|tether|usdc)\b|cryptocurrenc(?:y|ies)|crypto (?:deposits?|withdrawals?|payments?|wallets?)/i],
  ["Telegram Stars", /telegram stars|priceStars/i],
];

// "Cashouts\r\n- Name on the payment app must match your account." -> ["", "Cashouts: Name on the payment app ..."]
function rulesBlock(raw: string): string[][] {
  let heading = "";
  return raw.split(/\\r\\n|\\n/).map((line) => line.trim()).filter(Boolean).flatMap((line) => {
    if (!line.startsWith("-")) { heading = line; return []; }
    return [["", `${heading ? `${heading}: ` : ""}${line.replace(/^-\s*/, "")}`]];
  });
}

// A site's own sentences about withdrawing or cashing out, from its visible text and the text inside its scripts.
export function cashoutRules(text: string): string[] {
  const pieces = [
    ...text.matchAll(/(?:N|createTextVNode|_v)\(\s*"([^"\\]{8,220})"\s*\)/g), // text inside Vue/Nuxt-built pages
    ...text.matchAll(/>([^<>{}]{8,220})</g), // text between tags, in pages and in templates inside scripts
    ...text.matchAll(/"(?:q|a|a_withdraw|text|title|desc|description|content)"\s*:\s*"([^"\\]{8,300})"/g), // FAQ-style data
    // A rules block in the site's settings, one rule per line (luckyvaults: "Name on the payment app must match...").
    // Each rule keeps its heading, so "Name on the payment app must match your account" reads as a cash-out rule.
    ...[...text.matchAll(/"rules"\s*:\s*"((?:[^"\\]|\\.){10,3000})"/g)].flatMap((m) => rulesBlock(m[1])),
  ].map((m) => m[1].replace(/&amp;/g, "&").replace(/\\xA0|&nbsp;/g, " ").replace(/\s+/g, " ").trim());
  const about = /withdraw|cash ?out|transfer out|redeem|payout/i;
  // Whole sentences only (four words or more), not button labels like "Withdraw" or "Withdrawable Amount:".
  return [...new Set(pieces.filter((p) => about.test(p) && p.split(" ").length >= 4 && !/[{}=;]|function|return /.test(p)))].slice(0, 8);
}

// A method counts only next to paying words or as a payment icon: DraftKings mentions "Bitcoin" as a prediction market.
const PAY_WORDS = /deposit|withdraw|cash ?out|payment|pay with|pay via|redeem|top.?up|recharge|cashier|checkout|payout|icon_|logo/i;
export function paymentMethods(text: string): string[] {
  return METHODS.filter(([, re]) => {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    return [...text.matchAll(g)].some((m) => PAY_WORDS.test(text.slice(Math.max(0, m.index! - 100), m.index! + m[0].length + 100)));
  }).map(([name]) => name);
}

export const FREE_MONEY = /free winnings? withdraw\w*|get free withdrawal access|withdrawable (?:amount|balance)|bonus (?:balance|money|funds|credits?) (?:cannot|can't|can not|is not|isn't) (?:be )?(?:withdrawn|withdrawable|cashed out)|free (?:credits?|coins|chips|spins?) (?:cannot|can't|can not) be (?:withdrawn|cashed out)|promo(?:tional)? (?:money|credits?|balance) (?:cannot|can't|is not)/i;

// The whole withdraw scheme, as far as the site's own words show it. Each part quotes the sentence it came from;
// a part the site doesn't mention stays null ("not stated"), never a guess.
export type Scheme = {
  deposit_first: string | null;      // does it say you must deposit (or pay) before you can withdraw
  share_per_deposit: string | null;  // how much of your balance each deposit lets you take out
  in_steps: string | null;           // paid out in pieces, VIP levels or "steps"
  conditions: string[];              // tasks, verification, invites, bonuses to earn first
  fees: string | null;               // fees, taxes or commissions on withdrawals
  free_money_locked: string | null;  // winnings from free or bonus credits kept apart until you deposit
};
export function withdrawScheme(rules: string[], text: string): Scheme {
  const find = (re: RegExp) => rules.find((r) => re.test(r)) ?? text.match(new RegExp(`[^."<>]{0,120}${re.source}[^."<>]{0,120}`, "i"))?.[0]?.trim() ?? null;
  const conditions = [
    [/verif(?:y|ication)|kyc/i, "verify your identity or account"], [/tasks?\b/i, "finish tasks"], [/invite|refer|friends/i, "invite friends"],
    [/earn more bonus|bonuses to withdraw|wager|turnover|play through|rollover/i, "play or earn bonuses up to a target"], [/\bvip\b/i, "reach a VIP level"],
  ].filter(([re]) => rules.some((r) => (re as RegExp).test(r))).map(([, what]) => what as string);
  return {
    deposit_first: find(/deposit (?:any amount |first |again )?(?:to|before|in order to) (?:become vip and )?(?:unlock |activate |release |process )?(?:your |the )?(?:withdraw|cash ?out)|deposit any amount (?:to|and) (?:become vip and )?(?:withdraw|receive your rewards in cash)|unlock (?:your |the )?withdrawals? (?:by|with) (?:a )?deposit/),
    share_per_deposit: find(/(?:transfer|withdraw|cash) out \d+\s?%(?:\s?~\s?\d+\s?%)? of (?:the |each |your )?deposit/),
    in_steps: rules.find((r) => /in steps|in stages|in parts|step by step/i.test(r)) ?? null,
    conditions,
    fees: find(/(?:withdrawal|cash ?out) (?:fee|tax|commission)|(?:fee|tax|commission) (?:to|before you can|for) (?:withdraw|cash ?out)/),
    // highcash7 keeps "Free Winning" apart, with a separate "Withdrawable Amount" and "Get Free Withdrawal Access".
    free_money_locked: rules.find((r) => FREE_MONEY.test(r)) ?? text.match(FREE_MONEY)?.[0] ?? null,
  };
}

export function limits(text: string): string[] {
  const found = [...text.matchAll(/\b(min(?:imum)?|max(?:imum)?)\.?\s+(deposit|withdrawal|withdraw|cash ?out)[^0-9$€]{0,20}([$€]\s?\d[\d,.]*|\d[\d,.]*\s?(?:USD|USDT|\$))/gi)]
    .map((m) => `${m[1].toLowerCase().startsWith("min") ? "minimum" : "maximum"} ${m[2].toLowerCase().replace("withdraw", "withdrawal").replace("withdrawalal", "withdrawal")} ${m[3].replace(/\s/g, "").replace(/[.,]+$/, "")}`);
  return [...new Set(found)].slice(0, 4);
}

// Personal payment accounts a site tells you to pay: luckyvaults.vip's settings say Chime "$Brian-Miller-685" with
// "Copy the $tag, pay in Chime, then upload the screenshot". Read from the site's payment settings ("name"/"value" pairs)
// and from plain text like "Cash App: $name".
const HANDLE_APPS: [string, RegExp][] = [["Cash App", /cash\s?app/i], ["Chime", /chime/i], ["Venmo", /venmo/i], ["Zelle", /zelle/i], ["PayPal", /paypal/i]];
export function paymentHandles(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/"name"\s*:\s*"([^"]{2,30})"[^{}]{0,80}?"value"\s*:\s*"(\$[A-Za-z][A-Za-z0-9_-]{1,30}|@[A-Za-z0-9_-]{3,30}|[\w.+-]+@[\w-]+\.[a-z.]{2,})"/g)) {
    const app = HANDLE_APPS.find(([, re]) => re.test(m[1]))?.[0];
    if (app) out.add(`${app} ${m[2]}`);
  }
  for (const m of text.matchAll(/\b(cash\s?app|chime|venmo)\b[^$@<>"]{0,25}([$@][A-Za-z][A-Za-z0-9_-]{2,30})\b/gi)) {
    const app = HANDLE_APPS.find(([, re]) => re.test(m[1]))![0];
    if (!/^\$(tag|value|cashtag|name)$/i.test(m[2])) out.add(`${app} ${m[2]}`);
  }
  for (const m of text.matchAll(/paypal\.me\/([A-Za-z0-9_-]{2,40})/gi)) out.add(`PayPal paypal.me/${m[1]}`);
  return [...out].slice(0, 10);
}
// Sites that say coins are loaded or cash-outs paid by hand after you send a screenshot.
export const MANUAL_PAYMENTS = /upload (?:the |your )?(?:payment )?screenshot|send (?:us )?(?:a |the )?screenshot|coins are loaded after|after our team checks (?:the|your) payment/i;
// Fish-table and sweepstakes game apps sold through resellers ("agents"): GameVault's APK has an agent/recharge system.
export const FISH_APPS = /\b(orion stars|fire kirin|juwa|game vault|gamevault|vblink|milky way|panda master|ultra panda|river sweeps|golden dragon|noble 777|cash machine|big winner|mafia ?777|v-?power|riversweeps)\b/gi;

// Asking to connect a crypto wallet: once connected, a site can ask you to approve transactions that empty it.
export const CONNECT_WALLET = /\b(connect (?:your |a )?wallet|walletconnect|tonconnect|ton-connect|wallet_connect)\b/i;
