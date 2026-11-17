import { test } from "node:test";
import assert from "node:assert/strict";
import { PriceSimulator, backfill } from "./sim.ts";

const MARKETS = [
  { symbol: "H100", base: 2.5, vol: 1 },
  { symbol: "A100", base: 1.2, vol: 0.8 },
];

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

test("prices stay positive and near base over a simulated week", () => {
  const sim = new PriceSimulator(MARKETS, seeded(1));
  let min = Infinity;
  let max = 0;
  for (let i = 0; i < 7 * 86400 / 2; i++) {
    const { prices } = sim.step(2);
    min = Math.min(min, prices[0]);
    max = Math.max(max, prices[0]);
  }
  assert.ok(min >= 2.5 * Math.exp(-0.5) - 1e-9, `min ${min}`);
  assert.ok(max <= 2.5 * Math.exp(0.5) + 1e-9, `max ${max}`);
  // a typical week should stay well inside the hard bounds
  assert.ok(min > 2.5 * 0.7 && max < 2.5 * 1.4, `range ${min}–${max}`);
});

test("net long skew pushes the price up on average", () => {
  const runs = 40;
  let up = 0;
  for (let r = 0; r < runs; r++) {
    const a = new PriceSimulator(MARKETS, seeded(r));
    const b = new PriceSimulator(MARKETS, seeded(r));
    for (let i = 0; i < 1800; i++) {
      a.step(2, [0.3, 0]);
      b.step(2, [0, 0]);
    }
    if (a.prices()[0] > b.prices()[0]) up++;
  }
  assert.equal(up, runs, "same noise, long skew should always end higher");
});

test("setPrice aligns the simulator", () => {
  const sim = new PriceSimulator(MARKETS, seeded(3));
  sim.setPrice(0, 2.75);
  assert.ok(Math.abs(sim.prices()[0] - 2.75) < 1e-9);
});

test("backfill ends exactly at the requested prices", () => {
  const { candles } = backfill(MARKETS, [2.6, 1.1], 1, 1_800_000_000, seeded(9));
  assert.equal(candles[0].length, 1440);
  assert.ok(Math.abs(candles[0].at(-1)!.c - 2.6) < 1e-9);
  assert.ok(Math.abs(candles[1].at(-1)!.c - 1.1) < 1e-9);
  for (const c of candles[0]) assert.ok(c.l <= Math.min(c.o, c.c) && c.h >= Math.max(c.o, c.c));
});
