// The usage log: one row per check, kept 30 days. No IP addresses; callers are a keyed hash, so a person's checks can
// be counted without knowing who they are. Only CASHOUT_DATABASE_URL is used (never another project's DATABASE_URL);
// without it (local runs) nothing is logged.
import { createHmac } from "crypto";
import { Pool } from "pg";

export const LOG_DAYS = 30;
let pool: Pool | null = null;

export async function openDb() {
  const url = process.env.CASHOUT_DATABASE_URL;
  if (!url) return;
  const p = new Pool({ connectionString: url, ssl: url.includes("/cloudsql/") ? undefined : { rejectUnauthorized: false } });
  await p.query(`CREATE TABLE IF NOT EXISTS checks (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    via TEXT NOT NULL,            -- web, api or telegram
    caller_hash TEXT,             -- keyed hash of the IP or Telegram user ID, never the raw value
    owner BOOLEAN NOT NULL DEFAULT FALSE,
    kind TEXT, verdict TEXT,
    input TEXT, result JSONB,
    ms INTEGER
  )`);
  await p.query(`CREATE INDEX IF NOT EXISTS checks_created ON checks (created_at)`);
  pool = p;
  setInterval(() => void pool?.query(`DELETE FROM checks WHERE created_at < NOW() - make_interval(days => $1)`, [LOG_DAYS]).catch(() => {}), 6 * 3600_000).unref();
}

export const callerHash = (what: string) => createHmac("sha256", process.env.CASHOUT_CALLER_HASH_SECRET || process.env.CASHOUT_DATABASE_URL || "local").update(what).digest("hex");

export async function logCheck(row: { via: string; caller: string | null; owner: boolean; kind: string; verdict: string; input: string; result: unknown; ms: number }) {
  if (!pool) return;
  try {
    await pool.query(`INSERT INTO checks (via, caller_hash, owner, kind, verdict, input, result, ms) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
      [row.via, row.caller ? callerHash(row.caller) : null, row.owner, row.kind, row.verdict, row.input.slice(0, 300), JSON.stringify(row.result), row.ms]);
  } catch (error) { console.error("check log failed:", error); }
}

// The owner page's numbers: checks per day and per answer, and the latest checks.
export async function ownerStats() {
  if (!pool) return null;
  const [days, verdicts, recent] = await Promise.all([
    pool.query(`SELECT (created_at AT TIME ZONE 'UTC')::date AS day, via, COUNT(*)::int AS n, COUNT(DISTINCT caller_hash)::int AS people
      FROM checks WHERE NOT owner GROUP BY 1, 2 ORDER BY 1 DESC LIMIT 60`),
    pool.query(`SELECT verdict, COUNT(*)::int AS n FROM checks WHERE NOT owner GROUP BY 1`),
    pool.query(`SELECT created_at, via, owner, kind, verdict, input, ms FROM checks ORDER BY id DESC LIMIT 50`),
  ]);
  return { days: days.rows, verdicts: verdicts.rows, recent: recent.rows };
}
