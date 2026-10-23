// Every outside lookup (websites, domain registries, certificate logs, blockchains) goes through one Net, so a check
// can run live, record what it saw, or replay a recording in tests. Recordings are real answers, saved once.
import fs from "fs";

export type Reply = { status: number; url: string; text: string; headers: Record<string, string> };
export type Net = {
  get: (url: string, o?: { headers?: Record<string, string>; timeoutMs?: number }) => Promise<Reply>;
  post: (url: string, body: unknown, o?: { headers?: Record<string, string>; timeoutMs?: number }) => Promise<Reply>;
};

// Sites see an ordinary phone browser: some scam pages show a blank or "bot" page to anything else.
export const BROWSER_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Mobile Safari/537.36";
const MAX_BYTES = 3_000_000;

async function fetchReply(url: string, init: RequestInit, timeoutMs: number): Promise<Reply> {
  try {
    const res = await fetch(url, { ...init, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, url: res.url || url, text: buf.subarray(0, MAX_BYTES).toString("utf8"), headers: Object.fromEntries((res.headers as any).entries()) };
  } catch (error: any) {
    // status 0 = no answer (timeout, DNS failure, refused). Callers report it as "couldn't check", never as a finding.
    return { status: 0, url, text: String(error?.cause?.code ?? error?.name ?? error), headers: {} };
  }
}

export const liveNet: Net = {
  get: (url, o = {}) => fetchReply(url, { headers: { "user-agent": BROWSER_UA, accept: "*/*", ...o.headers } }, o.timeoutMs ?? 12_000),
  post: (url, body, o = {}) => fetchReply(url, {
    method: "POST", body: JSON.stringify(body), headers: { "user-agent": BROWSER_UA, "content-type": "application/json", ...o.headers },
  }, o.timeoutMs ?? 12_000),
};

const key = (method: string, url: string, body?: unknown) => `${method} ${url}${body === undefined ? "" : ` ${JSON.stringify(body)}`}`;

// Wraps a Net and keeps every answer, to save as a test fixture.
export function recordingNet(inner: Net = liveNet) {
  const seen: Record<string, Reply> = {};
  const net: Net = {
    get: async (url, o) => (seen[key("GET", url)] = await inner.get(url, o)),
    post: async (url, body, o) => (seen[key("POST", url, body)] = await inner.post(url, body, o)),
  };
  return { net, save: (file: string, meta: Record<string, unknown>) => fs.writeFileSync(file, JSON.stringify({ ...meta, replies: seen }, null, 1)) };
}

// Plays a recording back. A lookup that wasn't recorded answers status 0, like a site that didn't respond.
export function replayNet(file: string): Net {
  const { replies } = JSON.parse(fs.readFileSync(file, "utf8")) as { replies: Record<string, Reply> };
  const miss = (url: string): Reply => ({ status: 0, url, text: "not recorded", headers: {} });
  return {
    get: async (url) => replies[key("GET", url)] ?? miss(url),
    post: async (url, body) => replies[key("POST", url, body)] ?? miss(url),
  };
}
