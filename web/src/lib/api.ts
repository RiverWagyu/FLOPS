import { KEEPER_URL } from "./config";

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

export type PoolState = { totalAssets: number; sharePrice: number; totalSupply: number };

/** The keeper wallet that posts prices; `lowGas` means trading is (about to be) paused. */
export type KeeperStatus = { address: string; balance: number; lowGas: boolean; lastError: string };

export type Trade = {
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

export type News = { id?: number; ts: number; market: number; headline: string; impact: number };

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

export type LeaderRow = {
  owner: string;
  pnl: number;
  marginUsed: number;
  trades: number;
  wins: number;
  liquidations: number;
  roi: number;
};

export type PoolInfo = PoolState & {
  apr: number;
  openInterest: number;
  utilization: number;
  history: { ts: number; sharePrice: number; tvl: number }[];
};

export type HistoryRow = {
  id: number;
  market: number;
  isLong: boolean;
  size: number;
  collateral: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  funding: number;
  fees: number;
  payout: number;
  realized: number;
  reason: number;
  openedAt: number;
  closedAt: number;
  tx: string;
};

export type History = {
  positions: HistoryRow[];
  orders: { id: number; market: number; isLong: boolean; collateral: number; size: number; triggerPrice: number; status: string; positionId: number | null; updatedAt: number }[];
  stats: { pnl: number; trades: number; marginUsed: number; wins: number };
};

export async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${KEEPER_URL}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}
