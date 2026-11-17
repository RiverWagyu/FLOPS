import { config } from "./config.ts";
import { kvGet, kvSet, type Db } from "./db.ts";
import { fromWad, perps, publicClient } from "./chain.ts";
import { bus, type TradeRow } from "./bus.ts";

const CHUNK = 2000n;
const REASONS = ["close", "tp", "sl", "liquidation"] as const;

/** Reads FlopsPerps events into Postgres for charts, history and leaderboards. */
export class Indexer {
  private blockTs = new Map<bigint, number>();
  constructor(private db: Db) {}

  async syncOnce(): Promise<void> {
    const stored = await kvGet(this.db, `lastBlock:${config.chainId}:${config.perps}`);
    let from = stored ? BigInt(stored) + 1n : config.startBlock;
    const head = await publicClient.getBlockNumber();
    while (from <= head) {
      const to = from + CHUNK - 1n < head ? from + CHUNK - 1n : head;
      const logs = await publicClient.getContractEvents({ ...perps, fromBlock: from, toBlock: to });
      for (const log of logs) {
        if (log.eventName === "PricesUpdated") continue;
        await this.handle(log as any);
      }
      await kvSet(this.db, `lastBlock:${config.chainId}:${config.perps}`, to.toString());
      from = to + 1n;
    }
  }

  private async timestamp(blockNumber: bigint): Promise<number> {
    let ts = this.blockTs.get(blockNumber);
    if (ts === undefined) {
      const block = await publicClient.getBlock({ blockNumber });
      ts = Number(block.timestamp) * 1000;
      this.blockTs.set(blockNumber, ts);
      if (this.blockTs.size > 500) this.blockTs.delete(this.blockTs.keys().next().value!);
    }
    return ts;
  }

  private async handle(log: { eventName: string; args: any; blockNumber: bigint; transactionHash: string; logIndex: number }) {
    const a = log.args;
    const ts = await this.timestamp(log.blockNumber);
    const tx = log.transactionHash;
    switch (log.eventName) {
      case "PositionOpened": {
        const owner = (a.owner as string).toLowerCase();
        await this.db.query(
          `INSERT INTO positions (id, owner, market, is_long, size, collateral, margin, entry_price, open_fee, order_id, opened_at, open_tx)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`,
          [Number(a.id), owner, Number(a.marketId), a.isLong, fromWad(a.size), fromWad(a.collateral), fromWad(a.margin),
            fromWad(a.entryPrice), fromWad(a.openFee), Number(a.orderId), ts, tx],
        );
        await this.trade(
          { market: Number(a.marketId), owner, positionId: Number(a.id), kind: "open", isLong: a.isLong,
            size: fromWad(a.size), price: fromWad(a.entryPrice), ts, tx },
          log.logIndex,
        );
        break;
      }
      case "PositionClosed": {
        const owner = (a.owner as string).toLowerCase();
        const reason = Number(a.reason);
        const payout = fromWad(a.payout);
        const realized = payout - fromWad(a.collateral);
        await this.db.query(
          `UPDATE positions SET status='closed', exit_price=$2, pnl=$3, funding=$4, close_fee=$5, payout=$6,
             realized=$7, reason=$8, executor=$9, closed_at=$10, close_tx=$11 WHERE id=$1`,
          [Number(a.id), fromWad(a.exitPrice), fromWad(a.pnl), fromWad(a.funding), fromWad(a.closeFee), payout,
            realized, reason, (a.executor as string).toLowerCase(), ts, tx],
        );
        const t: TradeRow = {
          market: Number(a.marketId), owner, positionId: Number(a.id), kind: REASONS[reason], isLong: a.isLong,
          size: fromWad(a.size), price: fromWad(a.exitPrice), ts, tx, realized,
        };
        await this.trade(t, log.logIndex);
        if (reason === 3) bus.publish({ type: "liquidation", trade: t });
        break;
      }
      case "TpSlUpdated":
        await this.db.query("UPDATE positions SET tp=$2, sl=$3 WHERE id=$1", [Number(a.id), fromWad(a.tp), fromWad(a.sl)]);
        break;
      case "OrderPlaced":
        await this.db.query(
          `INSERT INTO orders (id, owner, market, is_long, collateral, size, trigger_price, tp, sl, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) ON CONFLICT (id) DO NOTHING`,
          [Number(a.id), (a.owner as string).toLowerCase(), Number(a.marketId), a.isLong, fromWad(a.collateral),
            fromWad(a.size), fromWad(a.triggerPrice), fromWad(a.tp), fromWad(a.sl), ts],
        );
        break;
      case "OrderCancelled":
        await this.db.query("UPDATE orders SET status='cancelled', updated_at=$2 WHERE id=$1", [Number(a.id), ts]);
        break;
      case "OrderExecuted":
        await this.db.query("UPDATE orders SET status='filled', position_id=$2, updated_at=$3 WHERE id=$1", [
          Number(a.id), Number(a.positionId), ts,
        ]);
        break;
    }
  }

  private async trade(t: TradeRow, logIndex: number) {
    const rows = await this.db.query(
      `INSERT INTO trades (market, owner, position_id, kind, is_long, size, price, ts, tx, log_index)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (tx, log_index) DO NOTHING RETURNING id`,
      [t.market, t.owner, t.positionId, t.kind, t.isLong, t.size, t.price, t.ts, t.tx, logIndex],
    );
    if (rows.length === 0) return; // already indexed
    await this.db.query("UPDATE candles SET v = v + $3 WHERE market=$1 AND t=$2", [
      t.market, Math.floor(t.ts / 60000) * 60, t.size,
    ]);
    bus.publish({ type: "trade", trade: t });
  }
}
