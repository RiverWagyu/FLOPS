import { test } from "node:test";
import assert from "node:assert/strict";
import { postReason, type PostInput } from "./schedule.ts";

const cfg = { simIntervalMs: 2000, viewerIntervalMs: 20000, watchIntervalMs: 15000, idleIntervalMs: 300000, priceDeviation: 0.005 };
const base: PostInput = { viewers: 0, openCount: 0, sinceLastPost: 0, drift: 0, triggered: false };
const mode = (s: Partial<PostInput>) => postReason({ ...base, ...s }, cfg)?.split(":")[0] ?? null;

test("viewers alone only need a slow heartbeat (trades refresh on request)", () => {
  assert.equal(mode({ viewers: 1, sinceLastPost: 2000 }), null);
  assert.equal(mode({ viewers: 1, sinceLastPost: 10000 }), null);
  assert.equal(mode({ viewers: 1, sinceLastPost: 20000 }), "live");
});

test("open positions: every 15s, or sooner on a trigger or price move", () => {
  assert.equal(mode({ openCount: 2, sinceLastPost: 4000 }), null);
  assert.equal(mode({ openCount: 2, sinceLastPost: 14000 }), "watching");
  assert.equal(mode({ openCount: 2, sinceLastPost: 2000, triggered: true }), "watching");
  assert.equal(mode({ openCount: 2, sinceLastPost: 2000, drift: 0.006 }), "watching");
  assert.equal(mode({ openCount: 2, sinceLastPost: 2000, drift: 0.004 }), null);
});

test("viewers don't delay risk checks on open positions", () => {
  assert.equal(mode({ viewers: 3, openCount: 1, sinceLastPost: 2000, drift: 0.01 }), "watching");
  assert.equal(mode({ viewers: 3, openCount: 1, sinceLastPost: 14000 }), "watching");
});

test("nothing open, nobody watching: heartbeat only", () => {
  assert.equal(mode({ sinceLastPost: 60_000, drift: 0.05 }), null);
  assert.equal(mode({ sinceLastPost: 300_000 }), "idle");
});

test("first tick after start always posts", () => {
  assert.equal(mode({ sinceLastPost: Date.now() }), "idle");
});
