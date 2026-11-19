import { test } from "node:test";
import assert from "node:assert/strict";
import { LIMITS, buildLiveContext, makeRateLimiter, validateMessages } from "./assistant.ts";

test("accepts a normal conversation and trims it", () => {
  const r = validateMessages([
    { role: "user", content: " what is funding? " },
    { role: "assistant", content: "It is..." },
    { role: "user", content: "thanks" },
  ]);
  assert.ok(r.ok);
  assert.equal(r.messages[0].content, "what is funding?");
});

test("rejects bad conversations", () => {
  assert.equal(validateMessages([]).ok, false);
  assert.equal(validateMessages("hi").ok, false);
  assert.equal(validateMessages([{ role: "system", content: "x" }]).ok, false);
  assert.equal(validateMessages([{ role: "assistant", content: "x" }]).ok, false);
  assert.equal(validateMessages([{ role: "user", content: "   " }]).ok, false);
  assert.equal(validateMessages([{ role: "user", content: "x".repeat(LIMITS.perMessage + 1) }]).ok, false);
  const long = Array.from({ length: LIMITS.messages + 1 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "x" }));
  assert.equal(validateMessages(long).ok, false);
});

test("live context lists markets, index and news", () => {
  const now = Date.parse("2026-11-19T12:00:00Z");
  const base = { high24h: 0, low24h: 0, volume24h: 1000, fundingRatePerHour: 0.0001, longOI: 500, shortOI: 200 };
  const ctx = buildLiveContext(
    {
      markets: [
        { symbol: "H100", price: 2.75, change24h: 0.1, ...base },
        { symbol: "A100", price: 1.2, change24h: 0, ...base },
        { symbol: "RTX4090", price: 0.4, change24h: 0, ...base },
        { symbol: "L40S", price: 0.9, change24h: 0, ...base },
      ],
      news: [{ ts: now - 30 * 60_000, market: 0, headline: "New model launch lifts demand", impact: 0.08 }],
      pool: { totalAssets: 1_000_000, sharePrice: 1.01 },
      page: "/trade/H100",
    },
    now,
  );
  assert.match(ctx, /^<live_data>/);
  assert.match(ctx, /H100: 2\.7500, 24h \+10\.00%/);
  assert.match(ctx, /FLOPS Compute Index: 102\.50/);
  assert.match(ctx, /30 min ago, H100, expected impact \+8\.0%: New model launch lifts demand/);
  assert.match(ctx, /page: \/trade\/H100/);
});

test("rate limiter allows max hits per window", () => {
  const allow = makeRateLimiter(2, 1000);
  assert.equal(allow("a", 0), true);
  assert.equal(allow("a", 10), true);
  assert.equal(allow("a", 20), false);
  assert.equal(allow("b", 20), true);
  assert.equal(allow("a", 1000), true);
});
