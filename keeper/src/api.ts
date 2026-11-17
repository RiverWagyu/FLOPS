import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { Db } from "./db.ts";
import { bus, type BusEvent } from "./bus.ts";
import { MARKETS } from "./config.ts";

export type MarketState = {
  id: number;
  symbol: string;
  name: string;
  price: number;
  onchainPrice: number;
  longOI: number;
  shortOI: number;
  fundingRatePerHour: number;
  maxPositionSize: number;
  longCapacity: number;
  shortCapacity: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
};

export type LiveState = {
  markets: MarketState[];
  pool: { totalAssets: number; sharePrice: number; totalSupply: number };
  lastTick: number;
  /** When prices were last posted on-chain (ms). */
  lastPost: number;
  chainId: number;
  keeper: KeeperStatus;
};

export type KeeperStatus = {
  address: string;
  /** Keeper wallet balance in ETH (pays gas for price posts and keeper actions). */
  balance: number;
  /** True when the balance can't cover many more price posts: trading is (about to be) paused. */
  lowGas: boolean;
  /** Last error from posting prices, "" when the last post succeeded. */
  lastError: string;
};

export type ApiHooks = {
  /** Make sure on-chain prices are fresh; resolves with when they were posted (ms). */
  refreshPrices: () => Promise<{ postedAt: number }>;
};

const TIMEFRAMES = new Set([60, 300, 900, 3600, 14400, 86400]);

export function startApi(db: Db, state: LiveState, port: number, corsOrigins: string[], hooks: ApiHooks) {
  // POST routes: called by the website right before a trade. A plain POST with no body
  // is a "simple" CORS request, so browsers don't need a preflight.
  const postRoutes: Record<string, () => Promise<unknown>> = {
    "/api/refresh-prices": async () => {
      try {
        return await hooks.refreshPrices();
      } catch (e) {
        throw new HttpError(503, state.keeper.lowGas ? "keeper-out-of-gas" : (e as Error).message.split("\n")[0]);
      }
    },
  };
  const routes: Record<string, (q: URLSearchParams) => Promise<unknown>> = {
    "/api/health": async () => ({
      ok: true,
      lastTick: state.lastTick,
      lastPost: state.lastPost,
      chainId: state.chainId,
      viewers: viewers(),
      keeper: state.keeper,
    }),
    "/api/markets": async () => state.markets,
    "/api/pool": async () => {
      const history = await db.query<{ ts: string; share_price: number; total_assets: number }>(
        "SELECT ts, share_price, total_assets FROM pool_snapshots WHERE ts > $1 ORDER BY ts",
        [Date.now() - 7 * 86400_000],
      );
      const first = history[0];
      const last = history.at(-1);
      let apr = 0;
      if (first && last && Number(last.ts) - Number(first.ts) > 3600_000 && first.share_price > 0) {
        const years = (Number(last.ts) - Number(first.ts)) / (365 * 86400_000);
        apr = (last.share_price / first.share_price - 1) / years;
      }
      const oi = state.markets.reduce((s, m) => s + m.longOI + m.shortOI, 0);
      return {
        ...state.pool,
        apr,
        openInterest: oi,
        utilization: state.pool.totalAssets > 0 ? oi / state.pool.totalAssets : 0,
        history: history.map((h) => ({ ts: Number(h.ts), sharePrice: h.share_price, tvl: h.total_assets })),
      };
    },
    "/api/candles": async (q) => {
      const market = Number(q.get("market") ?? 0);
      const tf = Number(q.get("tf") ?? 60);
      const limit = Math.min(Number(q.get("limit") ?? 500), 2000);
      if (!TIMEFRAMES.has(tf)) throw new HttpError(400, "bad tf");
      const rows = await db.query<{ t: string; o: number; h: number; l: number; c: number; v: number }>(
        `SELECT (t / $2) * $2 AS t,
                (array_agg(o ORDER BY t))[1] AS o, max(h) AS h, min(l) AS l,
                (array_agg(c ORDER BY t DESC))[1] AS c, sum(v) AS v
         FROM candles WHERE market = $1 AND t >= $4
         GROUP BY 1 ORDER BY 1 DESC LIMIT $3`,
        [market, tf, limit, Math.floor(Date.now() / 1000) - tf * limit],
      );
      return rows.reverse().map((r) => ({ t: Number(r.t), o: r.o, h: r.h, l: r.l, c: r.c, v: Number(r.v) }));
    },
    "/api/trades": async (q) => {
      const market = q.get("market");
      const limit = Math.min(Number(q.get("limit") ?? 50), 200);
      return db.query(
        `SELECT market, owner, position_id AS "positionId", kind, is_long AS "isLong", size, price, ts, tx
         FROM trades ${market !== null ? "WHERE market = $2" : ""} ORDER BY ts DESC, id DESC LIMIT $1`,
        market !== null ? [limit, Number(market)] : [limit],
      ).then(numify);
    },
    "/api/news": async (q) =>
      db.query("SELECT id, ts, market, headline, impact FROM news ORDER BY ts DESC LIMIT $1", [
        Math.min(Number(q.get("limit") ?? 20), 100),
      ]).then(numify),
    "/api/liquidations": async (q) =>
      db.query(
        `SELECT id AS "positionId", owner, market, is_long AS "isLong", size, collateral, exit_price AS price, closed_at AS ts, close_tx AS tx
         FROM positions WHERE status='closed' AND reason = 3 ORDER BY closed_at DESC LIMIT $1`,
        [Math.min(Number(q.get("limit") ?? 20), 100)],
      ).then(numify),
    "/api/leaderboard": async (q) => {
      const roi = q.get("type") === "roi";
      return db.query(
        `SELECT owner, SUM(realized) AS pnl, SUM(collateral) AS "marginUsed", COUNT(*) AS trades,
                SUM(CASE WHEN realized > 0 THEN 1 ELSE 0 END) AS wins,
                SUM(CASE WHEN reason = 3 THEN 1 ELSE 0 END) AS liquidations,
                SUM(realized) / NULLIF(SUM(collateral), 0) AS roi
         FROM positions WHERE status='closed'
         GROUP BY owner ${roi ? "HAVING SUM(collateral) >= 100" : ""}
         ORDER BY ${roi ? "roi" : "pnl"} DESC LIMIT 100`,
      ).then(numify);
    },
    "/api/history": async (q) => {
      const owner = (q.get("owner") ?? "").toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(owner)) throw new HttpError(400, "bad owner");
      const [positions, orders, stats] = await Promise.all([
        db.query(
          `SELECT id, market, is_long AS "isLong", size, collateral, entry_price AS "entryPrice", exit_price AS "exitPrice",
                  pnl, funding, open_fee + COALESCE(close_fee,0) AS fees, payout, realized, reason, opened_at AS "openedAt",
                  closed_at AS "closedAt", close_tx AS tx
           FROM positions WHERE owner=$1 AND status='closed' ORDER BY closed_at DESC LIMIT 200`,
          [owner],
        ),
        db.query(
          `SELECT id, market, is_long AS "isLong", collateral, size, trigger_price AS "triggerPrice", status,
                  position_id AS "positionId", created_at AS "createdAt", updated_at AS "updatedAt"
           FROM orders WHERE owner=$1 AND status <> 'open' ORDER BY updated_at DESC LIMIT 100`,
          [owner],
        ),
        db.query(
          `SELECT COALESCE(SUM(realized),0) AS pnl, COUNT(*) AS trades, COALESCE(SUM(collateral),0) AS "marginUsed",
                  SUM(CASE WHEN realized > 0 THEN 1 ELSE 0 END) AS wins
           FROM positions WHERE owner=$1 AND status='closed'`,
          [owner],
        ),
      ]);
      return { positions: numify(positions), orders: numify(orders), stats: numify(stats)[0] };
    },
  };

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const origin = req.headers.origin;
    if (origin && (corsOrigins.includes("*") || corsOrigins.includes(origin))) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") return void res.writeHead(204).end();
    const url = new URL(req.url ?? "/", "http://x");
    const handler =
      req.method === "GET" ? routes[url.pathname] : req.method === "POST" ? postRoutes[url.pathname] : undefined;
    if (!handler) return void res.writeHead(404).end();
    req.resume(); // ignore any request body
    try {
      const body = await handler(url.searchParams);
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(body));
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error("[api]", e);
      res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify({ error: (e as Error).message }));
    }
  });

  const wss = new WebSocketServer({ server, path: "/ws" });
  // Browsers report whether their tab is visible, so a forgotten background tab doesn't keep
  // the keeper posting prices (and spending gas) at full speed.
  const hidden = new WeakSet<WebSocket>();
  wss.on("connection", (ws: WebSocket) => {
    ws.send(JSON.stringify({ type: "snapshot", markets: state.markets, pool: state.pool, keeper: state.keeper }));
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(String(data));
        if (msg?.type === "visibility") msg.visible ? hidden.delete(ws) : hidden.add(ws);
      } catch {
        /* ignore malformed client messages */
      }
    });
  });
  bus.on("event", (e: BusEvent) => {
    const msg = JSON.stringify(e.type === "tick" ? { ...e, markets: state.markets, pool: state.pool, keeper: state.keeper } : e);
    for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
  });

  server.listen(port, () => console.log(`[api] http://localhost:${port}  (ws /ws)`));
  /** Number of connected browsers with the site in a visible tab. */
  const viewers = () => {
    let n = 0;
    for (const c of wss.clients) if (c.readyState === 1 && !hidden.has(c)) n++;
    return n;
  };
  return { server, viewers };
}

class HttpError extends Error {
  constructor(readonly status: number, msg: string) {
    super(msg);
  }
}

/** Postgres returns BIGINT/NUMERIC as strings; convert numeric-looking fields. */
function numify<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map((r) => {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      o[k] = typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) && k !== "owner" && k !== "tx" ? Number(v) : v;
    }
    return o as T;
  });
}

export function emptyMarkets(): MarketState[] {
  return MARKETS.map((m, id) => ({
    id, symbol: m.symbol, name: m.name, price: m.base, onchainPrice: m.base, longOI: 0, shortOI: 0,
    fundingRatePerHour: 0, maxPositionSize: 0, longCapacity: 0, shortCapacity: 0,
    change24h: 0, high24h: m.base, low24h: m.base, volume24h: 0,
  }));
}
