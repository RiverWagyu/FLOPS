import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  base as baseWallet,
  bitgetWallet,
  braveWallet,
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  okxWallet,
  phantomWallet,
  rabbyWallet,
  rainbowWallet,
  trustWallet,
  uniswapWallet,
  walletConnectWallet,
  zerionWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { mock } from "wagmi/connectors";
import { baseSepolia } from "viem/chains";
import { defineChain } from "viem";
import { deployments, perpsAbi, tusdAbi, vaultAbi } from "@/generated/contracts";

export const anvil = defineChain({
  id: 31337,
  name: "Anvil (local)",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});

export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337);
export const CHAIN = CHAIN_ID === 84532 ? baseSepolia : anvil;
export const IS_LOCAL = CHAIN_ID === 31337;
export const KEEPER_URL = process.env.NEXT_PUBLIC_KEEPER_URL ?? "http://localhost:8787";
export const EXPLORER = CHAIN_ID === 84532 ? "https://sepolia.basescan.org" : "";

const dep = deployments[CHAIN_ID];
const addr = (env: string | undefined, fallback: string | undefined) => (env || fallback) as `0x${string}`;

export const contracts = {
  perps: { address: addr(process.env.NEXT_PUBLIC_PERPS_ADDRESS, dep?.perps), abi: perpsAbi },
  vault: { address: addr(process.env.NEXT_PUBLIC_VAULT_ADDRESS, dep?.vault), abi: vaultAbi },
  tusd: { address: addr(process.env.NEXT_PUBLIC_TUSD_ADDRESS, dep?.tusd), abi: tusdAbi },
} as const;
export const DEPLOYED = Boolean(contracts.perps.address);

/** Anvil account #2 — a public, well-known test key. Only offered on the local chain. */
export const DEV_ACCOUNT = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;

/** The mock connector forgets its connection on reload, so remember it ourselves (local chain only). */
export const DEV_WALLET_KEY = "flops.devWallet";
function devWalletRemembered() {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(DEV_WALLET_KEY) === "1";
  } catch {
    return false;
  }
}

const projectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? "";

/**
 * These connect directly: as a browser extension, a passkey popup (Base) or their own app link.
 * Wallets installed in the browser also show up on their own, through EIP-6963.
 */
const directWallets = [rabbyWallet, phantomWallet, braveWallet, injectedWallet];
/**
 * These reach a phone app or a QR code through WalletConnect when they aren't installed in the
 * browser, which only works with a real WalletConnect project ID.
 */
const walletConnectWallets = [trustWallet, okxWallet, rainbowWallet, zerionWallet, uniswapWallet, bitgetWallet, walletConnectWallet];

const walletConnectors = connectorsForWallets(
  [
    { groupName: "Recommended", wallets: [baseWallet, metaMaskWallet, coinbaseWallet] },
    { groupName: "More wallets", wallets: [...(projectId ? walletConnectWallets : []), ...directWallets] },
  ],
  { appName: "FLOPS", projectId: projectId || "flops-demo" },
);

export const wagmiConfig = createConfig({
  chains: [CHAIN],
  connectors: [
    ...walletConnectors,
    ...(IS_LOCAL
      ? [mock({ accounts: [DEV_ACCOUNT], features: { reconnect: true, defaultConnected: devWalletRemembered() } })]
      : []),
  ],
  transports: { [CHAIN.id]: http(process.env.NEXT_PUBLIC_RPC_URL || undefined) } as Record<number, ReturnType<typeof http>>,
  // The app renders client-side only (see client-providers.tsx), so no SSR hydration mode.
  ssr: false,
});
