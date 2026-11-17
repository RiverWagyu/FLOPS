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
  priceIntervalMs: Number(env("PRICE_INTERVAL_MS", "2000")),
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
