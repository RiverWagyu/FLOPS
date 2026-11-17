import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  nonceManager,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { config } from "./config.ts";
import { perpsAbi, vaultAbi } from "./generated/contracts.ts";

const anvil = defineChain({
  id: 31337,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});

const chain: Chain = config.chainId === 84532 ? baseSepolia : anvil;

export const account = privateKeyToAccount(config.keeperKey, { nonceManager });
export const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl), pollingInterval: 1000 });
export const walletClient = createWalletClient({ chain, account, transport: http(config.rpcUrl) });

export const perps = { address: config.perps, abi: perpsAbi } as const;
export const vault = { address: config.vault, abi: vaultAbi } as const;

export const WAD = 10n ** 18n;
export const fromWad = (v: bigint) => Number(v) / 1e18;
export const toWad = (v: number) => BigInt(Math.round(v * 1e12)) * 10n ** 6n;
