"use client";

import { useAccount, useWatchAsset } from "wagmi";
import { contracts } from "@/lib/config";
import { useToast } from "./Toasts";

/** Tokens a wallet can be asked to track, with their logos (served from /public/tokens). */
const TOKENS = {
  // FLP is an ERC-4626 share: tUSD's 18 decimals + the vault's 3-decimal offset.
  FLP: { address: contracts.vault.address, symbol: "FLP", decimals: 21, image: "/tokens/flp.png" },
  tUSD: { address: contracts.tusd.address, symbol: "tUSD", decimals: 18, image: "/tokens/tusd.png" },
} as const;

/** One click to add FLP or tUSD (with its logo) to the connected wallet via `wallet_watchAsset`. */
export function AddTokenButton({ token, className = "" }: { token: keyof typeof TOKENS; className?: string }) {
  const { isConnected } = useAccount();
  const { watchAssetAsync, isPending } = useWatchAsset();
  const toast = useToast();
  if (!isConnected) return null;
  const t = TOKENS[token];

  async function add() {
    try {
      const added = await watchAssetAsync({
        type: "ERC20",
        // Wallets fetch the logo themselves, so it must be an absolute URL.
        options: { address: t.address, symbol: t.symbol, decimals: t.decimals, image: `${window.location.origin}${t.image}` },
      });
      if (added) toast.push({ kind: "success", title: `${t.symbol} added to your wallet` });
    } catch (e) {
      const msg = (e as Error)?.message ?? "";
      if (/reject|denied|cancel/i.test(msg)) return;
      toast.push({
        kind: "error",
        title: `Couldn't add ${t.symbol}`,
        body: `This wallet doesn't support adding tokens. Import it manually: ${t.address} (${t.decimals} decimals).`,
      });
    }
  }

  return (
    <button
      type="button"
      onClick={add}
      disabled={isPending}
      className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted hover:bg-panel-3 hover:text-fg disabled:opacity-50 ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={t.image} alt="" width={16} height={16} className="h-4 w-4 rounded-full" />
      Add {t.symbol} to wallet
    </button>
  );
}
