import type { Db } from "./db.ts";
import { account, perps, publicClient, walletClient } from "./chain.ts";

type Fn = "liquidate" | "executeTpSl" | "executeOrder";

/**
 * Finds positions to liquidate, TP/SL to trigger and limit orders to fill, then submits them.
 * Every call is simulated first so the keeper never pays for a reverting transaction.
 * The contract re-checks every condition on-chain; this is just the trigger.
 */
export class Executor {
  private inflight = new Set<string>();
  constructor(private db: Db) {}

  async run(prices: number[]): Promise<void> {
    const open = await this.db.query<{ id: string; market: number; is_long: boolean; tp: number; sl: number }>(
      "SELECT id, market, is_long, tp, sl FROM positions WHERE status='open'",
    );

    // 1. liquidations (on-chain status includes funding)
    const liquidatable = new Set<string>();
    for (let i = 0; i < open.length; i += 200) {
      const chunk = open.slice(i, i + 200);
      const statuses = await publicClient.readContract({
        ...perps,
        functionName: "positionStatuses",
        args: [chunk.map((p) => BigInt(p.id))],
      });
      statuses.forEach((s, j) => {
        if (s.liquidatable) liquidatable.add(String(chunk[j].id));
      });
    }
    for (const id of liquidatable) this.submit("liquidate", BigInt(id));

    // 2. take-profit / stop-loss
    for (const p of open) {
      if (liquidatable.has(String(p.id)) || (!p.tp && !p.sl)) continue;
      const price = prices[p.market];
      const hit = p.is_long
        ? (p.tp > 0 && price >= p.tp) || (p.sl > 0 && price <= p.sl)
        : (p.tp > 0 && price <= p.tp) || (p.sl > 0 && price >= p.sl);
      if (hit) this.submit("executeTpSl", BigInt(p.id));
    }

    // 3. limit orders
    const orders = await this.db.query<{ id: string; market: number; is_long: boolean; trigger_price: number }>(
      "SELECT id, market, is_long, trigger_price FROM orders WHERE status='open'",
    );
    for (const o of orders) {
      const price = prices[o.market];
      if (o.is_long ? price <= o.trigger_price : price >= o.trigger_price) this.submit("executeOrder", BigInt(o.id));
    }
  }

  private submit(fn: Fn, id: bigint) {
    const key = `${fn}:${id}`;
    if (this.inflight.has(key)) return;
    this.inflight.add(key);
    (async () => {
      try {
        const { request } = await publicClient.simulateContract({ ...perps, functionName: fn, args: [id], account });
        const hash = await walletClient.writeContract(request);
        await publicClient.waitForTransactionReceipt({ hash, timeout: 30_000 });
        console.log(`[exec] ${fn}(${id}) ${hash}`);
      } catch (e) {
        // Usually a race (already closed / price moved). The next tick will retry if still valid.
        const msg = (e as Error).message.split("\n")[0];
        if (!/NotTriggered|NoPosition|NoOrder|NotLiquidatable/.test(msg)) console.warn(`[exec] ${fn}(${id}) failed: ${msg}`);
      } finally {
        // keep the key a little longer so the indexer can catch up before we retry
        setTimeout(() => this.inflight.delete(key), 4_000);
      }
    })();
  }
}
