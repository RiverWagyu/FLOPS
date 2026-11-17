import type { NextConfig } from "next";

const EMPTY = "./src/lib/empty.ts";

// Optional dependencies of wallet SDKs that FLOPS never uses:
// - pino-pretty / async-storage: WalletConnect logger + React Native storage
// - @x402/*: lazily-imported crypto-payment helpers inside @coinbase/cdp-sdk (pulled in by Base Account)
const unused = ["pino-pretty", "@react-native-async-storage/async-storage"];
const x402 = ["@x402/core/client", "@x402/evm", "@x402/evm/exact/client", "@x402/evm/upto/client", "@x402/svm/exact/client"];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    resolveAlias: {
      ...Object.fromEntries(unused.map((m) => [m, EMPTY])),
      ...Object.fromEntries(x402.map((m) => [m, "./src/lib/x402-stub.ts"])),
    },
  },
};

export default nextConfig;
