// Works out what someone pasted: a website, a Telegram bot or channel, or a crypto wallet.
export type Chain = "solana" | "evm" | "tron" | "ton" | "bitcoin" | "litecoin" | "dogecoin";
export type Target =
  | { kind: "site"; domain: string; url: string }
  | { kind: "telegram"; username: string }
  | { kind: "wallet"; address: string; chains: Chain[] }
  | { kind: "unknown"; text: string };

const WALLETS: [RegExp, Chain[]][] = [
  [/^0x[a-fA-F0-9]{40}$/, ["evm"]],
  [/^T[1-9A-HJ-NP-Za-km-z]{33}$/, ["tron"]],
  [/^(EQ|UQ)[A-Za-z0-9_-]{46}$/, ["ton"]],
  [/^(bc1[a-z0-9]{25,62}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/, ["bitcoin"]],
  [/^(ltc1[a-z0-9]{25,62}|[LM][1-9A-HJ-NP-Za-km-z]{26,33})$/, ["litecoin"]],
  [/^D[1-9A-HJ-NP-Za-km-z]{33}$/, ["dogecoin"]],
  [/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, ["solana"]],
];

export function parseTarget(raw: string): Target {
  const text = raw.trim();
  const tg = text.match(/^(?:https?:\/\/)?(?:t\.me|telegram\.me)\/(?:s\/)?([A-Za-z0-9_]{4,32})/i) ?? text.match(/^@([A-Za-z0-9_]{4,32})$/);
  if (tg) return { kind: "telegram", username: tg[1] };
  for (const [re, chains] of WALLETS) if (re.test(text)) return { kind: "wallet", address: text, chains };
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const u = new URL(withScheme);
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname)) return { kind: "site", domain: registrable(u.hostname), url: `https://${u.hostname}/` };
  } catch { /* not a URL */ }
  return { kind: "unknown", text: text.slice(0, 200) };
}

// "pp.pragmaticsplaygames.com" -> "pragmaticsplaygames.com"; "game.co.uk" stays whole. Registries answer for this part.
const TWO_PART_TLDS = /\.(co|com|org|net|gov|ac)\.[a-z]{2}$|\.org\.uk$/i;
export function registrable(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".");
  return parts.slice(TWO_PART_TLDS.test(host) ? -3 : -2).join(".");
}
