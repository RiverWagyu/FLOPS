import { test } from "node:test";
import assert from "node:assert/strict";
import { computeIndex, indexChange, indexSeries, spread } from "./computeIndex.ts";

const near = (a: number | null, b: number) => assert.ok(a !== null && Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test("index is 100 at listing prices", () => {
  near(computeIndex([2.5, 1.2, 0.4, 0.9]), 100);
});

test("index is the equal-weighted average move", () => {
  // H100 +20%, others flat → (1.2 + 1 + 1 + 1) / 4 = 1.05
  near(computeIndex([3.0, 1.2, 0.4, 0.9]), 105);
  // RTX 4090 +20% moves the index just as much as H100 +20%
  near(computeIndex([2.5, 1.2, 0.48, 0.9]), 105);
});

test("index rejects missing or bad prices", () => {
  assert.equal(computeIndex([]), null);
  assert.equal(computeIndex([2.5, 1.2, 0.4]), null);
  assert.equal(computeIndex([2.5, 1.2, 0, 0.9]), null);
});

test("series keeps only timestamps every market has", () => {
  const s = indexSeries(
    [
      [{ t: 1, c: 2.5 }, { t: 2, c: 3.0 }, { t: 3, c: 3.0 }],
      [{ t: 1, c: 1.2 }, { t: 2, c: 1.2 }],
      [{ t: 1, c: 0.4 }, { t: 2, c: 0.4 }, { t: 3, c: 0.4 }],
      [{ t: 1, c: 0.9 }, { t: 2, c: 0.9 }, { t: 3, c: 0.9 }],
    ],
  );
  assert.deepEqual(s.map((p) => p.t), [1, 2]);
  near(s[0].value, 100);
  near(s[1].value, 105);
});

test("spread and 24h index change", () => {
  const sp = spread(2.5, 1.25);
  assert.ok(sp);
  near(sp.gap, 1.25);
  near(sp.ratio, 2);
  assert.equal(spread(0, 1), null);
  // every market +10% → index +10%
  near(indexChange([2.75, 1.32, 0.44, 0.99], [0.1, 0.1, 0.1, 0.1]), 0.1);
});
