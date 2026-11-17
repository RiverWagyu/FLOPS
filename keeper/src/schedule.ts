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
  priceIntervalMs: number;
  watchIntervalMs: number;
  idleIntervalMs: number;
  priceDeviation: number;
};

/**
 * Decides whether this tick's simulated prices should be posted on-chain, and why
 * ("mode: detail"). Returns null to skip the (gas-costing) transaction.
 * Ticks are SIM_INTERVAL_MS apart, so intervals are matched to the nearest tick.
 */
export function postReason(s: PostInput, c: PostConfig): string | null {
  const due = (interval: number) => s.sinceLastPost >= interval - c.simIntervalMs / 2;
  if (s.viewers > 0) {
    return due(c.priceIntervalMs) || s.triggered ? `live: ${s.viewers} viewer(s)` : null;
  }
  if (s.openCount > 0) {
    if (s.triggered) return "watching: order triggered";
    if (s.drift >= c.priceDeviation) return "watching: price moved";
    return due(c.watchIntervalMs) ? "watching: open positions" : null;
  }
  return due(c.idleIntervalMs) ? "idle: heartbeat" : null;
}
