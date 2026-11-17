import { config, MARKETS } from "./config.ts";
import { openDb, type Db } from "./db.ts";
import { PriceSimulator, backfill } from "./sim.ts";
import { account, fromWad, perps, publicClient, toWad, vault, walletClient } from "./chain.ts";
import { Indexer } from "./indexer.ts";
import { Executor } from "./executor.ts";
import { startApi, emptyMarkets, type LiveState } from "./api.ts";
import { bus } from "./bus.ts";

const BACKFILL_DAYS = 7;

async function main() {
  console.log(`[keeper] chain ${config.chainId}  perps ${config.perps}  keeper ${account.address}`);
  const db = await openDb(config.databaseUrl);

  const onchainKeeper = await publicClient.readContract({ ...perps, functionName: "keeper" });
  if (onchainKeeper.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(`KEEPER_PRIVATE_KEY is ${account.address} but the contract keeper is ${onchainKeeper}`);
  }

  const chainMarkets = await publicClient.readContract({ ...perps, functionName: "getMarkets" });
  if (chainMarkets.length !== MARKETS.length) {
    throw new Error(`Contract has ${chainMarkets.length} markets, keeper config has ${MARKETS.length}`);
  }
  const startPrices = chainMarkets.map((m) => fromWad(m.price));

  const sim = new PriceSimulator(MARKETS);
  startPrices.forEach((p, i) => sim.setPrice(i, p));
  await ensureHistory(db, startPrices);

  const state: LiveState = {
    markets: emptyMarkets(),
    pool: { totalAssets: 0, sharePrice: 1, totalSupply: 0 },
    lastTick: 0,
    chainId: config.chainId,
  };
  startPrices.forEach((p, i) => {
    state.markets[i].price = p;
    state.markets[i].onchainPrice = p;
  });

  const indexer = new Indexer(db);
  const executor = new Executor(db);
  startApi(db, state, config.port, config.corsOrigins);

  // indexer loop
  (async function indexLoop() {
    try {
      await indexer.syncOnce();
    } catch (e) {
      console.warn("[indexer]", (e as Error).message.split("\n")[0]);
    }
    setTimeout(indexLoop, 1500);
  })();

  // 24h stats + pool snapshots
  const refreshStats = async () => {
    try {
      await refresh24h(db, state);
    } catch (e) {
      console.warn("[stats]", (e as Error).message);
    }
  };
  await refreshStats();
  setInterval(refreshStats, 30_000);
  setInterval(() => snapshotPool(db).catch((e) => console.warn("[pool]", e.message)), 60_000);
  await snapshotPool(db).catch(() => {});

  // price loop
  let last = Date.now();
  let failures = 0;
  const tick = async () => {
    const started = Date.now();
    try {
      const [markets, poolAssets, supply, sharePrice] = await Promise.all([
        publicClient.readContract({ ...perps, functionName: "getMarkets" }),
        publicClient.readContract({ ...vault, functionName: "totalAssets" }),
        publicClient.readContract({ ...vault, functionName: "totalSupply" }),
        publicClient.readContract({ ...vault, functionName: "convertToAssets", args: [10n ** 21n] }),
      ]);
      const pool = fromWad(poolAssets);
      const skews = markets.map((m) => (pool > 0 ? (fromWad(m.longSize) - fromWad(m.shortSize)) / pool : 0));

      const dt = Math.min((started - last) / 1000, 30);
      last = started;
      const { prices, events } = sim.step(dt, skews, started);

      const hash = await walletClient.writeContract({
        ...perps,
        functionName: "setPrices",
        args: [prices.map(toWad)],
      });
      await publicClient.waitForTransactionReceipt({ hash, timeout: 20_000 });

      for (const ev of events) {
        const [row] = await db.query<{ id: number }>(
          "INSERT INTO news (ts, market, headline, impact) VALUES ($1,$2,$3,$4) RETURNING id",
          [ev.ts, ev.market, ev.headline, ev.impact],
        );
        bus.publish({ type: "news", news: { ...ev, id: Number(row.id) } });
        console.log(`[news] ${ev.headline} (${(ev.impact * 100).toFixed(1)}%)`);
      }
      await upsertCandles(db, prices, started);

      markets.forEach((m, i) => {
        const s = state.markets[i];
        s.price = prices[i];
        s.onchainPrice = prices[i];
        s.longOI = fromWad(m.longSize);
        s.shortOI = fromWad(m.shortSize);
        s.fundingRatePerHour = fromWad(m.fundingRatePerHour);
        s.maxPositionSize = fromWad(m.maxPositionSize);
        s.longCapacity = fromWad(m.longCapacity);
        s.shortCapacity = fromWad(m.shortCapacity);
        s.high24h = Math.max(s.high24h, prices[i]);
        s.low24h = Math.min(s.low24h, prices[i]);
      });
      state.pool = { totalAssets: pool, totalSupply: fromWad(supply) / 1000, sharePrice: fromWad(sharePrice) };
      state.lastTick = started;
      bus.publish({ type: "tick", t: started, prices });

      await executor.run(prices);
      failures = 0;
    } catch (e) {
      failures++;
      console.warn(`[tick] failed (${failures}):`, (e as Error).message.split("\n")[0]);
    }
    const wait = Math.max(200, config.priceIntervalMs - (Date.now() - started));
    setTimeout(tick, failures > 3 ? 5_000 : wait);
  };
  tick();
}

async function ensureHistory(db: Db, endPrices: number[]) {
  const [{ n }] = await db.query<{ n: string }>("SELECT COUNT(*) AS n FROM candles");
  if (Number(n) > 0) return;
  console.log(`[keeper] backfilling ${BACKFILL_DAYS} days of simulated history…`);
  const nowSec = Math.floor(Date.now() / 1000);
  // End the backfill one minute before now so the live loop owns the current candle.
  const { candles, events } = backfill(MARKETS, endPrices, BACKFILL_DAYS, nowSec - 60);
  for (let m = 0; m < candles.length; m++) {
    const series = candles[m];
    for (let i = 0; i < series.length; i += 500) {
      const chunk = series.slice(i, i + 500);
      const values: unknown[] = [];
      const ph = chunk.map((c, j) => {
        // simulated background volume so history isn't empty; live volume comes from real trades
        values.push(m, c.t, c.o, c.h, c.l, c.c, Math.round(Math.random() * Math.random() * 8_000));
        const b = j * 7;
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`;
      });
      await db.query(`INSERT INTO candles (market,t,o,h,l,c,v) VALUES ${ph.join(",")} ON CONFLICT DO NOTHING`, values);
    }
  }
  for (const ev of events.slice(-40)) {
    await db.query("INSERT INTO news (ts, market, headline, impact) VALUES ($1,$2,$3,$4)", [
      ev.ts, ev.market, ev.headline, ev.impact,
    ]);
  }
}

async function upsertCandles(db: Db, prices: number[], nowMs: number) {
  const t = Math.floor(nowMs / 60000) * 60;
  const values: unknown[] = [];
  const ph = prices.map((p, i) => {
    values.push(i, t, p);
    const b = i * 3;
    return `($${b + 1},$${b + 2},$${b + 3},$${b + 3},$${b + 3},$${b + 3},0)`;
  });
  await db.query(
    `INSERT INTO candles (market,t,o,h,l,c,v) VALUES ${ph.join(",")}
     ON CONFLICT (market,t) DO UPDATE SET h = GREATEST(candles.h, EXCLUDED.h), l = LEAST(candles.l, EXCLUDED.l), c = EXCLUDED.c`,
    values,
  );
}

async function refresh24h(db: Db, state: LiveState) {
  const since = Math.floor(Date.now() / 1000) - 86400;
  const rows = await db.query<{ market: number; open: number; h: number; l: number; v: number }>(
    `SELECT market, (array_agg(o ORDER BY t))[1] AS open, max(h) AS h, min(l) AS l, sum(v) AS v
     FROM candles WHERE t >= $1 GROUP BY market`,
    [since],
  );
  for (const r of rows) {
    const s = state.markets[r.market];
    if (!s) continue;
    s.change24h = r.open > 0 ? s.price / r.open - 1 : 0;
    s.high24h = Math.max(r.h, s.price);
    s.low24h = Math.min(r.l, s.price);
    s.volume24h = Number(r.v);
  }
}

async function snapshotPool(db: Db) {
  const [assets, supply, sharePrice] = await Promise.all([
    publicClient.readContract({ ...vault, functionName: "totalAssets" }),
    publicClient.readContract({ ...vault, functionName: "totalSupply" }),
    publicClient.readContract({ ...vault, functionName: "convertToAssets", args: [10n ** 21n] }),
  ]);
  await db.query(
    "INSERT INTO pool_snapshots (ts, total_assets, total_supply, share_price) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
    [Date.now(), fromWad(assets), fromWad(supply) / 1000, fromWad(sharePrice)],
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
