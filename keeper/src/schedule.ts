export type PostInput = {
  /** Browsers with the site open in a visible tab. */
  viewers: number;
  /** Open positions + open limit orders. */
  openCount: number;
  /** ms since prices were last posted on-chain. */
  sinceLastPost: number;
  /** Largest relative gap between simulated and on-chain prices. */
  drift: number;
  /** A TP/SL or limit order would trigger at the simulated prices. */
  triggered: boolean;
};

export type PostConfig = {
  simIntervalMs: number;
  viewerIntervalMs: number;
  watchIntervalMs: number;
  idleIntervalMs: number;
  priceDeviation: number;
};

/**
 * Decides whether this tick's simulated prices should be posted on-chain, and why
 * ("mode: detail"). Returns null to skip the (gas-costing) transaction.
 * Trades get a fresh price on request instead (see /api/refresh-prices), so watching alone
 * only needs a slow heartbeat. Ticks are SIM_INTERVAL_MS apart, so intervals match the nearest tick.
 */
export function postReason(s: PostInput, c: PostConfig): string | null {
  const due = (interval: number) => s.sinceLastPost >= interval - c.simIntervalMs / 2;
  if (s.openCount > 0 && s.triggered) return "watching: order triggered";
  if (s.openCount > 0 && s.drift >= c.priceDeviation) return "watching: price moved";
  if (s.viewers > 0 && due(c.viewerIntervalMs)) return `live: ${s.viewers} viewer(s)`;
  if (s.openCount > 0 && due(c.watchIntervalMs)) return "watching: open positions";
  if (due(c.idleIntervalMs)) return "idle: heartbeat";
  return null;
}
