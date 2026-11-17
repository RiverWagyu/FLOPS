/**
 * Chart indicators. Each returns one value per input value, `null` until it has enough history,
 * so results line up index-for-index with the candles they were computed from.
 */

/** Simple moving average of the last `n` values. */
export function sma(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  values.forEach((v, i) => {
    sum += v;
    if (i >= n) sum -= values[i - n];
    out.push(i >= n - 1 ? sum / n : null);
  });
  return out;
}

/** Exponential moving average, seeded with the SMA of the first `n` values. */
export function ema(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = [];
  const k = 2 / (n + 1);
  let prev: number | null = null;
  values.forEach((v, i) => {
    if (i < n - 1) return out.push(null);
    if (prev === null) {
      prev = values.slice(0, n).reduce((a, b) => a + b, 0) / n;
    } else {
      prev = v * k + prev * (1 - k);
    }
    out.push(prev);
  });
  return out;
}

/** Bollinger Bands: SMA(n) ± `mult` population standard deviations. */
export function bollinger(values: number[], n = 20, mult = 2) {
  const mid = sma(values, n);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  mid.forEach((m, i) => {
    if (m === null) {
      upper.push(null);
      lower.push(null);
      return;
    }
    const window = values.slice(i - n + 1, i + 1);
    const sd = Math.sqrt(window.reduce((s, v) => s + (v - m) ** 2, 0) / n);
    upper.push(m + mult * sd);
    lower.push(m - mult * sd);
  });
  return { mid, upper, lower };
}

/** Relative Strength Index with Wilder's smoothing (0–100). */
export function rsi(values: number[], n = 14): (number | null)[] {
  const out: (number | null)[] = values.map(() => null);
  if (values.length <= n) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= n;
  loss /= n;
  const value = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
  out[n] = value();
  for (let i = n + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = value();
  }
  return out;
}
