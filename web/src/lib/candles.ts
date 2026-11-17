export type Ohlc = { time: number; open: number; high: number; low: number; close: number };

/**
 * Groups price samples (ms timestamps, oldest first) into OHLC candles of `bucketSec` seconds.
 * Each candle opens at the previous candle's close, so the series has no gaps between bodies,
 * which suits a value sampled once a minute (like the FLP share price).
 */
export function toCandles(points: { ts: number; value: number }[], bucketSec: number): Ohlc[] {
  const out: Ohlc[] = [];
  for (const p of points) {
    if (!Number.isFinite(p.value)) continue;
    const time = Math.floor(p.ts / 1000 / bucketSec) * bucketSec;
    const cur = out.at(-1);
    if (cur && cur.time === time) {
      cur.high = Math.max(cur.high, p.value);
      cur.low = Math.min(cur.low, p.value);
      cur.close = p.value;
    } else if (!cur || time > cur.time) {
      const open = cur ? cur.close : p.value;
      out.push({ time, open, high: Math.max(open, p.value), low: Math.min(open, p.value), close: p.value });
    }
  }
  return out;
}
