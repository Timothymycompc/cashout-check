// Checks a wallet a casino or game tells you to pay: what it holds, how busy it is, and whether it ever pays anyone.
// Public blockchain data only. A wallet on its own rarely proves a scam, so most of this is facts, not verdicts.
import type { Net } from "../net";
import type { Chain } from "./input";
import type { Finding } from "./types";
import { caseForAddress } from "./known";

type Seen = { chain: string; holds: string[]; sent_out: boolean | null; activity: string | null; source: string };
const num = (n: number, d = 2) => n.toLocaleString("en-US", { maximumFractionDigits: d });
const rpc = (net: Net, url: string, method: string, params: unknown[]) =>
  net.post(url, { jsonrpc: "2.0", id: 1, method, params }).then((r) => (r.status === 200 ? JSON.parse(r.text).result : undefined)).catch(() => undefined);

const SOLANA_RPC = "https://api.mainnet-beta.solana.com";
const STABLES_SOL: Record<string, string> = { Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "USDT", EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC" };
async function solana(net: Net, a: string): Promise<Seen | null> {
  const [bal, sigs, toks] = await Promise.all([
    rpc(net, SOLANA_RPC, "getBalance", [a]),
    rpc(net, SOLANA_RPC, "getSignaturesForAddress", [a, { limit: 1000 }]),
    rpc(net, SOLANA_RPC, "getTokenAccountsByOwner", [a, { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }, { encoding: "jsonParsed" }]),
  ]);
  if (bal === undefined) return null;
  const holds = [`${num(bal.value / 1e9, 4)} SOL`];
  for (const t of toks?.value ?? []) {
    const i = t.account.data.parsed.info, sym = STABLES_SOL[i.mint];
    if (sym && Number(i.tokenAmount.uiAmount) > 0) holds.push(`${num(Number(i.tokenAmount.uiAmount))} ${sym}`);
  }
  const s: any[] = sigs ?? [];
  const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
  const activity = s.length ? `${s.length >= 1000 ? "1,000+" : s.length} transactions, ${day(s[s.length - 1].blockTime)} to ${day(s[0].blockTime)}` : "no transactions";
  return { chain: "Solana", holds, sent_out: null, activity, source: "Solana mainnet (public RPC)" };
}

const USDT_TRON = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
async function tron(net: Net, a: string): Promise<Seen | null> {
  const r = await net.get(`https://api.trongrid.io/v1/accounts/${a}`);
  if (r.status !== 200) return null;
  const acct = JSON.parse(r.text).data?.[0];
  if (!acct) return { chain: "Tron", holds: [], sent_out: false, activity: "never used", source: "TronGrid" };
  const usdt = (acct.trc20 ?? []).map((x: any) => x[USDT_TRON]).find(Boolean);
  const out = await net.get(`https://api.trongrid.io/v1/accounts/${a}/transactions/trc20?only_from=true&limit=1`);
  const sentOut = out.status === 200 ? (JSON.parse(out.text).data ?? []).length > 0 : null;
  return { chain: "Tron", holds: [`${num(acct.balance / 1e6)} TRX`, ...(usdt ? [`${num(Number(usdt) / 1e6)} USDT`] : [])], sent_out: sentOut,
    activity: acct.create_time ? `in use since ${new Date(acct.create_time).toISOString().slice(0, 10)}` : null, source: "TronGrid" };
}

async function ton(net: Net, a: string): Promise<Seen | null> {
  const r = await net.get(`https://tonapi.io/v2/accounts/${a}`);
  if (r.status !== 200) return null;
  const d = JSON.parse(r.text);
  // "uninit": money has arrived but the wallet has never sent anything (sending is what sets a TON wallet up).
  return { chain: "TON", holds: [`${num(Number(d.balance) / 1e9)} TON`], sent_out: d.status === "uninit" ? false : d.status === "active" ? true : null,
    activity: d.last_activity ? `last active ${new Date(d.last_activity * 1000).toISOString().slice(0, 10)}` : null, source: "tonapi.io" };
}

const EVM: { name: string; rpc: string; usdt: string; decimals: number; coin: string }[] = [
  { name: "Ethereum", rpc: "https://ethereum-rpc.publicnode.com", usdt: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6, coin: "ETH" },
  { name: "BNB Chain", rpc: "https://bsc-rpc.publicnode.com", usdt: "0x55d398326f99059fF775485246999027B3197955", decimals: 18, coin: "BNB" },
  { name: "Base", rpc: "https://base-rpc.publicnode.com", usdt: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6, coin: "ETH" },
];
async function evm(net: Net, a: string): Promise<Seen[]> {
  const data = `0x70a08231000000000000000000000000${a.slice(2).toLowerCase()}`;
  const out = await Promise.all(EVM.map(async (c): Promise<Seen | null> => {
    const [bal, nonce, usdt] = await Promise.all([rpc(net, c.rpc, "eth_getBalance", [a, "latest"]), rpc(net, c.rpc, "eth_getTransactionCount", [a, "latest"]), rpc(net, c.rpc, "eth_call", [{ to: c.usdt, data }, "latest"])]);
    if (bal === undefined) return null;
    const native = Number(BigInt(bal)) / 1e18, sent = Number(BigInt(nonce ?? "0x0")), tether = usdt && usdt !== "0x" ? Number(BigInt(usdt)) / 10 ** c.decimals : 0;
    if (native === 0 && sent === 0 && tether === 0) return null;
    return { chain: c.name, holds: [`${num(native, 4)} ${c.coin}`, ...(tether ? [`${num(tether)} USDT`] : [])], sent_out: sent > 0, activity: `${sent} transactions sent`, source: `${c.name} (public node)` };
  }));
  return out.filter((x): x is Seen => x !== null);
}

const BLOCKCHAIR: Partial<Record<Chain, [string, string, number]>> = { bitcoin: ["bitcoin", "BTC", 1e8], litecoin: ["litecoin", "LTC", 1e8], dogecoin: ["dogecoin", "DOGE", 1e8] };
async function utxo(net: Net, chain: Chain, a: string): Promise<Seen | null> {
  const [slug, coin, unit] = BLOCKCHAIR[chain]!;
  const r = await net.get(`https://api.blockchair.com/${slug}/dashboards/address/${a}`);
  if (r.status !== 200) return null;
  const d = JSON.parse(r.text).data?.[a]?.address;
  if (!d) return null;
  return { chain: slug[0].toUpperCase() + slug.slice(1), holds: [`${num(d.balance / unit, 6)} ${coin}`], sent_out: d.spent > 0,
    activity: `${d.transaction_count} transactions, received ${num(d.received / unit, 6)} ${coin}${d.first_seen_receiving ? ` since ${String(d.first_seen_receiving).slice(0, 10)}` : ""}`, source: "Blockchair" };
}

export async function checkWallet(net: Net, address: string, chains: Chain[]) {
  const findings: Finding[] = [];
  const known = caseForAddress(address);
  if (known) findings.push({ rule: "known_case", result: "fail", detail: `This is a deposit wallet from a case we investigated: ${known.name} (${known.checked}). ${known.summary}`, source: `CashOut Check case file: ${known.evidence}`, why: "We found this address in the scam's own code." });
  else findings.push({ rule: "known_case", result: "pass", detail: "Not a wallet from any case we've investigated.", source: "CashOut Check case files", why: "Checked against every case on record." });

  const seen: Seen[] = [];
  for (const chain of chains) {
    if (chain === "solana") { const s = await solana(net, address); if (s) seen.push(s); }
    else if (chain === "tron") { const s = await tron(net, address); if (s) seen.push(s); }
    else if (chain === "ton") { const s = await ton(net, address); if (s) seen.push(s); }
    else if (chain === "evm") seen.push(...await evm(net, address));
    else { const s = await utxo(net, chain, address); if (s) seen.push(s); }
  }
  if (!seen.length) findings.push({ rule: "wallet_activity", result: "unknown", detail: "Couldn't read this wallet from the public blockchain services, or it has never been used.", source: "public blockchain data", why: "We only report what the chain shows." });
  for (const s of seen) {
    findings.push({ rule: "wallet_activity", result: "info", detail: `${s.chain}: holds ${s.holds.join(" + ") || "nothing"}${s.activity ? `; ${s.activity}` : ""}.`, source: s.source, why: "Shows how much money this wallet is collecting." });
    const holdsMoney = s.holds.some((h) => !/^0 /.test(h));
    if (s.sent_out === false && holdsMoney) findings.push({ rule: "never_pays_out", result: "warn", detail: `${s.chain}: money has come in, but this wallet has never sent anything out. A shared wallet that only collects is not paying players back from here.`, source: s.source, why: "Prog Coin's TON deposit wallet held 3,903 TON and had never sent any." });
  }
  return { findings, facts: { address, chains: seen } };
}
