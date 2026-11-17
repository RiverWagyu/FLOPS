import { EventEmitter } from "node:events";

/** In-process pub/sub between the price loop, indexer and WebSocket API. */
export type BusEvent =
  | { type: "tick"; t: number; prices: number[] }
  | { type: "trade"; trade: TradeRow }
  | { type: "news"; news: { id?: number; ts: number; market: number; headline: string; impact: number } }
  | { type: "liquidation"; trade: TradeRow };

export type TradeRow = {
  market: number;
  owner: string;
  positionId: number;
  kind: "open" | "close" | "tp" | "sl" | "liquidation";
  isLong: boolean;
  size: number;
  price: number;
  ts: number;
  tx: string;
  realized?: number;
};

class Bus extends EventEmitter {
  publish(e: BusEvent) {
    this.emit("event", e);
  }
}

export const bus = new Bus();
bus.setMaxListeners(1000);
