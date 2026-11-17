"use client";

import dynamic from "next/dynamic";

/**
 * Wallet SDKs (Base Account, WalletConnect) are browser-only and pull in Node-only optional
 * dependencies during server rendering, so the whole wallet-aware app renders on the client.
 */
export const ClientProviders = dynamic(() => import("./providers").then((m) => m.Providers), {
  ssr: false,
  loading: () => (
    <div className="flex h-[60vh] items-center justify-center">
      <div className="flex items-center gap-3 text-sm text-muted">
        <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
        Loading FLOPS…
      </div>
    </div>
  ),
});
