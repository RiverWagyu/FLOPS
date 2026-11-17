import { test } from "node:test";
import assert from "node:assert/strict";
import { smallerChunk } from "./rpc-limits.ts";

test("uses the range a public RPC says it allows", () => {
  // sepolia.base.org's actual error text
  assert.equal(smallerChunk("eth_getLogs is limited to a 200 range", 2000n), 200n);
  assert.equal(smallerChunk("query exceeds maximum block range of 500", 2000n), 500n);
});

test("halves on generic too-large errors", () => {
  assert.equal(smallerChunk("Log response size exceeded. You can make eth_getLogs requests with up to a 2K block range", 2000n), 1000n);
  assert.equal(smallerChunk("block range is too wide", 300n), 150n);
});

test("doesn't loop forever and ignores unrelated errors", () => {
  assert.equal(smallerChunk("eth_getLogs is limited to a 200 range", 200n), 100n);
  assert.equal(smallerChunk("block range is too wide", 1n), null);
  assert.equal(smallerChunk("fetch failed", 2000n), null);
  assert.equal(smallerChunk("rate limit reached", 2000n), null);
});
