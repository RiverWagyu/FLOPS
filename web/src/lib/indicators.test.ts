import { test } from "node:test";
import assert from "node:assert/strict";
import { bollinger, ema, rsi, sma } from "./indicators.ts";
import { toCandles } from "./candles.ts";

const close = (a: (number | null)[], b: (number | null)[]) =>
  a.forEach((v, i) => (v === null ? assert.equal(b[i], null) : assert.ok(Math.abs(v - (b[i] as number)) < 1e-9, `${i}: ${v} vs ${b[i]}`)));

test("sma averages the last n values and waits for enough history", () => {
  close(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
});

test("ema seeds with the sma, then weights recent values more", () => {
  // k = 2/(3+1) = 0.5: seed 2, then 4*0.5+2*0.5 = 3, then 5*0.5+3*0.5 = 4
  close(ema([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  close(ema([1, 2, 3, 10], 3), [null, null, 2, 6]);
});

test("bollinger bands sit 2 standard deviations around the sma", () => {
  const { mid, upper, lower } = bollinger([2, 4, 4, 4, 5, 5, 7, 9], 8, 2); // population sd of this set = 2
  assert.equal(mid[7], 5);
  assert.equal(upper[7], 9);
  assert.equal(lower[7], 1);
  assert.equal(upper[6], null);
});

test("rsi is 100 when prices only rise, 0 when they only fall, 50 when flat", () => {
  const up = Array.from({ length: 20 }, (_, i) => 100 + i);
  assert.equal(rsi(up, 14).at(-1), 100);
  assert.equal(rsi(up.toReversed(), 14).at(-1), 0);
  assert.equal(rsi(Array(20).fill(5), 14).at(-1), 50);
  assert.equal(rsi(up, 14)[13], null);
});

test("rsi matches the classic worked example", () => {
  // 15 closes → 14 changes: average gain 0.23857, average loss 0.1 → RSI 70.464.
  // (Published tables show 70.53 because they round the averages to 0.24 / 0.10 first.)
  const c = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
  assert.ok(Math.abs((rsi(c, 14)[14] as number) - 70.464) < 0.001);
});

test("toCandles groups samples into buckets, each opening at the previous close", () => {
  const t0 = Date.UTC(2026, 10, 17, 12, 0, 0);
  const pts = [1, 1.02, 0.99, 1.01, 1.03, 1.0, 0.98].map((value, i) => ({ ts: t0 + i * 60_000, value }));
  assert.deepEqual(toCandles(pts, 300), [
    { time: t0 / 1000, open: 1, high: 1.03, low: 0.99, close: 1.03 },
    { time: t0 / 1000 + 300, open: 1.03, high: 1.03, low: 0.98, close: 0.98 },
  ]);
});
