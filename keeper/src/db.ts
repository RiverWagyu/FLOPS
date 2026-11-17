import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** Minimal SQL interface shared by node-postgres (production) and PGlite (local dev). */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS candles (
  market INT NOT NULL, t BIGINT NOT NULL,
  o DOUBLE PRECISION NOT NULL, h DOUBLE PRECISION NOT NULL,
  l DOUBLE PRECISION NOT NULL, c DOUBLE PRECISION NOT NULL,
  v DOUBLE PRECISION NOT NULL DEFAULT 0,
  PRIMARY KEY (market, t)
);

CREATE TABLE IF NOT EXISTS positions (
  id BIGINT PRIMARY KEY, owner TEXT NOT NULL, market INT NOT NULL, is_long BOOLEAN NOT NULL,
  size DOUBLE PRECISION NOT NULL, collateral DOUBLE PRECISION NOT NULL, margin DOUBLE PRECISION NOT NULL,
  entry_price DOUBLE PRECISION NOT NULL, open_fee DOUBLE PRECISION NOT NULL,
  tp DOUBLE PRECISION NOT NULL DEFAULT 0, sl DOUBLE PRECISION NOT NULL DEFAULT 0,
  order_id BIGINT NOT NULL DEFAULT 0, opened_at BIGINT NOT NULL, open_tx TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  exit_price DOUBLE PRECISION, pnl DOUBLE PRECISION, funding DOUBLE PRECISION, close_fee DOUBLE PRECISION,
  payout DOUBLE PRECISION, realized DOUBLE PRECISION, reason INT, executor TEXT,
  closed_at BIGINT, close_tx TEXT
);
CREATE INDEX IF NOT EXISTS positions_owner ON positions (owner);
CREATE INDEX IF NOT EXISTS positions_status ON positions (status);

CREATE TABLE IF NOT EXISTS orders (
  id BIGINT PRIMARY KEY, owner TEXT NOT NULL, market INT NOT NULL, is_long BOOLEAN NOT NULL,
  collateral DOUBLE PRECISION NOT NULL, size DOUBLE PRECISION NOT NULL, trigger_price DOUBLE PRECISION NOT NULL,
  tp DOUBLE PRECISION NOT NULL, sl DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', position_id BIGINT,
  created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_owner ON orders (owner);

CREATE TABLE IF NOT EXISTS trades (
  id BIGSERIAL PRIMARY KEY, market INT NOT NULL, owner TEXT NOT NULL, position_id BIGINT NOT NULL,
  kind TEXT NOT NULL, is_long BOOLEAN NOT NULL, size DOUBLE PRECISION NOT NULL,
  price DOUBLE PRECISION NOT NULL, ts BIGINT NOT NULL, tx TEXT NOT NULL, log_index INT NOT NULL,
  UNIQUE (tx, log_index)
);
CREATE INDEX IF NOT EXISTS trades_market_ts ON trades (market, ts DESC);

CREATE TABLE IF NOT EXISTS news (
  id BIGSERIAL PRIMARY KEY, ts BIGINT NOT NULL, market INT NOT NULL,
  headline TEXT NOT NULL, impact DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS pool_snapshots (
  ts BIGINT PRIMARY KEY, total_assets DOUBLE PRECISION NOT NULL,
  total_supply DOUBLE PRECISION NOT NULL, share_price DOUBLE PRECISION NOT NULL
);
`;

export async function openDb(databaseUrl: string): Promise<Db> {
  let db: Db;
  if (databaseUrl) {
    const { default: pg } = await import("pg");
    const pool = new pg.Pool({
      connectionString: databaseUrl,
      // No TLS for local databases or Railway's private network (*.railway.internal);
      // public hosts (e.g. Railway's TCP proxy, Neon, Supabase) need it.
      ssl:
        /localhost|127\.0\.0\.1|\.railway\.internal|sslmode=disable/.test(databaseUrl)
          ? undefined
          : { rejectUnauthorized: false },
    });
    db = {
      query: async (sql, params) => (await pool.query(sql, params as unknown[])).rows,
      exec: async (sql) => {
        await pool.query(sql);
      },
    };
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const dir = join(dirname(fileURLToPath(import.meta.url)), "..", ".data", "pglite");
    mkdirSync(dir, { recursive: true });
    const lite = new PGlite(dir);
    db = {
      query: async <T>(sql: string, params?: unknown[]) => (await lite.query<T>(sql, params)).rows,
      exec: async (sql) => {
        await lite.exec(sql);
      },
    };
  }
  await db.exec(SCHEMA);
  return db;
}

export async function kvGet(db: Db, key: string): Promise<string | undefined> {
  const rows = await db.query<{ value: string }>("SELECT value FROM kv WHERE key = $1", [key]);
  return rows[0]?.value;
}

export async function kvSet(db: Db, key: string, value: string): Promise<void> {
  await db.query(
    "INSERT INTO kv (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [key, value],
  );
}
