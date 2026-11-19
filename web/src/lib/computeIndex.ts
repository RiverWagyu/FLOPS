/**
 * FLOPS Compute Index: one number for "the price of AI compute".
 *
 * Each GPU's price is divided by its listing price (the price the market opened at), and the
 * index is the equal-weighted average of those ratios × 100. So 100 means "compute costs what it
 * did at launch", 110 means 10% more expensive on average. Equal weights keep a cheap GPU like
 * the RTX 4090 from being drowned out by the H100.
 */

/** Listing prices in tUSD per GPU-hour, in market-id order (H100, A100, RTX4090, L40S). */
export const LISTING_PRICES = [2.5, 1.2, 0.4, 0.9] as const;

export function computeIndex(prices: readonly number[], base: readonly number[] = LISTING_PRICES): number | null {
  if (prices.length === 0 || prices.length !== base.length) return null;
  let sum = 0;
  for (let i = 0; i < prices.length; i++) {
    if (!(prices[i] > 0) || !(base[i] > 0)) return null;
    sum += prices[i] / base[i];
  }
  return (100 * sum) / prices.length;
}

type Close = { t: number; c: number };

/**
 * Index over time from each market's candle closes. Only timestamps present in every market are
 * used, so a gap in one market never shows up as a fake jump in the index.
 */
export function indexSeries(series: readonly (readonly Close[])[], base: readonly number[] = LISTING_PRICES) {
  if (series.length === 0 || series.length !== base.length) return [];
  const maps = series.map((s) => new Map(s.map((p) => [p.t, p.c])));
  const out: { t: number; value: number }[] = [];
  for (const { t } of series[0]) {
    const closes = maps.map((m) => m.get(t));
    if (closes.some((c) => c === undefined)) continue;
    const value = computeIndex(closes as number[], base);
    if (value !== null) out.push({ t, value });
  }
  return out;
}

/** How much more an H100-hour costs than an A100-hour, in tUSD and as a multiple. */
export function spread(a: number, b: number) {
  if (!(a > 0) || !(b > 0)) return null;
  return { gap: a - b, ratio: a / b };
}

/** 24h change of the index from each market's 24h change (prices now vs. 24h ago). */
export function indexChange(prices: readonly number[], changes: readonly number[], base: readonly number[] = LISTING_PRICES) {
  const now = computeIndex(prices, base);
  const before = computeIndex(
    prices.map((p, i) => p / (1 + changes[i])),
    base,
  );
  if (now === null || before === null) return null;
  return now / before - 1;
}
