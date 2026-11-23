import { test } from "node:test";
import assert from "node:assert/strict";
import { isMobileUA, metaMaskDappLink, withTimeout } from "./mobile.ts";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

test("phones are mobile, desktops are not", () => {
  assert.equal(isMobileUA(IPHONE), true);
  assert.equal(isMobileUA(ANDROID), true);
  assert.equal(isMobileUA(MAC, 0), false);
});

test("an iPad posing as a Mac is told apart by touch points", () => {
  assert.equal(isMobileUA(MAC, 5), true);
});

test("MetaMask link opens the same page in the in-app browser", () => {
  assert.equal(
    metaMaskDappLink("https://flops-iota.vercel.app/trade/H100?x=1"),
    "https://metamask.app.link/dapp/flops-iota.vercel.app/trade/H100?x=1",
  );
});

test("withTimeout falls back when a call never answers or fails", async () => {
  assert.equal(await withTimeout(new Promise<string>(() => {}), 10, "fallback"), "fallback");
  assert.equal(await withTimeout(Promise.reject(new Error("x")), 10, "fallback"), "fallback");
  assert.equal(await withTimeout(Promise.resolve("ok"), 10, "fallback"), "ok");
});
