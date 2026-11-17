import { test } from "node:test";
import assert from "node:assert/strict";
import { postReason, type PostInput } from "./schedule.ts";

const cfg = { simIntervalMs: 2000, priceIntervalMs: 2000, watchIntervalMs: 15000, idleIntervalMs: 300000, priceDeviation: 0.005 };
const base: PostInput = { viewers: 0, openCount: 0, sinceLastPost: 0, drift: 0, triggered: false };
const mode = (s: Partial<PostInput>) => postReason({ ...base, ...s }, cfg)?.split(":")[0] ?? null;

test("viewers get a post every tick", () => {
  assert.equal(mode({ viewers: 1, sinceLastPost: 2000 }), "live");
  assert.equal(mode({ viewers: 1, sinceLastPost: 500 }), null);
});

test("nobody watching, positions open: every 15s, or sooner on a trigger or price move", () => {
  assert.equal(mode({ openCount: 2, sinceLastPost: 4000 }), null);
  assert.equal(mode({ openCount: 2, sinceLastPost: 14000 }), "watching");
  assert.equal(mode({ openCount: 2, sinceLastPost: 2000, triggered: true }), "watching");
  assert.equal(mode({ openCount: 2, sinceLastPost: 2000, drift: 0.006 }), "watching");
  assert.equal(mode({ openCount: 2, sinceLastPost: 2000, drift: 0.004 }), null);
});

test("nothing open, nobody watching: heartbeat only", () => {
  assert.equal(mode({ sinceLastPost: 60_000, drift: 0.05 }), null);
  assert.equal(mode({ sinceLastPost: 300_000 }), "idle");
});

test("first tick after start always posts", () => {
  assert.equal(mode({ sinceLastPost: Date.now() }), "idle");
});
