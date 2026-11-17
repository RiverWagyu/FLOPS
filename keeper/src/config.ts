import { deployments } from "./generated/contracts.ts";

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== "") return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing env var ${name}`);
}

const chainId = Number(env("CHAIN_ID", "31337"));
const dep = deployments[chainId];

export const config = {
  chainId,
  rpcUrl: env("RPC_URL", "http://127.0.0.1:8545"),
  keeperKey: env("KEEPER_PRIVATE_KEY") as `0x${string}`,
  databaseUrl: process.env.DATABASE_URL || "",
  port: Number(env("PORT", "8787")),
  // The simulator ticks (and the website updates) every SIM_INTERVAL_MS. Posting prices on-chain
  // costs gas, so the keeper only does it when needed:
  //   a trader opens or closes        → on request (POST /api/refresh-prices), so fills match the
  //                                     price on screen
  //   someone has the site open       → every VIEWER_INTERVAL_MS, keeping the on-chain price inside
  //                                     the contract's 30s freshness limit while wallets confirm
  //   trades open                     → every WATCH_INTERVAL_MS, or at once if a TP/SL/limit order
  //                                     triggers or a price drifts PRICE_DEVIATION from on-chain
  //   nothing open, nobody watching   → every IDLE_INTERVAL_MS (heartbeat)
  simIntervalMs: Number(env("SIM_INTERVAL_MS", "2000")),
  viewerIntervalMs: Number(env("VIEWER_INTERVAL_MS", "20000")),
  watchIntervalMs: Number(env("WATCH_INTERVAL_MS", "15000")),
  idleIntervalMs: Number(env("IDLE_INTERVAL_MS", "300000")),
  priceDeviation: Number(env("PRICE_DEVIATION", "0.005")),
  /** A refresh request is skipped if prices were posted this recently. */
  freshMs: Number(env("FRESH_MS", "3000")),
  /** Below this keeper balance (ETH) the site warns that trading is paused. */
  lowGasEth: Number(env("LOW_GAS_ETH", "0.000005")),
  corsOrigins: env("CORS_ORIGINS", "http://localhost:3000").split(",").map((s) => s.trim()),
  perps: (process.env.PERPS_ADDRESS || dep?.perps) as `0x${string}`,
  vault: (process.env.VAULT_ADDRESS || dep?.vault) as `0x${string}`,
  tusd: (process.env.TUSD_ADDRESS || dep?.tusd) as `0x${string}`,
  startBlock: BigInt(process.env.START_BLOCK || dep?.startBlock || 0),
};

if (!config.perps || !config.vault) {
  throw new Error(`No deployment found for chain ${chainId}. Deploy the contracts and run \`npm run abi\` first.`);
}

/** Simulation settings per market, in contract market-id order. */
export const MARKETS = [
  { symbol: "H100", name: "NVIDIA H100 80GB", base: 2.5, vol: 1.0 },
  { symbol: "A100", name: "NVIDIA A100 80GB", base: 1.2, vol: 0.8 },
  { symbol: "RTX4090", name: "NVIDIA RTX 4090", base: 0.4, vol: 1.4 },
  { symbol: "L40S", name: "NVIDIA L40S", base: 0.9, vol: 1.1 },
] as const;
