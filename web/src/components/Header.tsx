"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useAccountEffect, useConnect } from "wagmi";
import { CHAIN, DEPLOYED, DEV_WALLET_KEY, IS_LOCAL, contracts } from "@/lib/config";
import { useLive } from "@/lib/live";
import { useTusdBalance } from "@/lib/hooks";
import { useExecute } from "@/lib/tx";
import { fmtUsd } from "@/lib/format";
import { Button } from "./ui";

const NAV = [
  { href: "/trade/H100", match: "/trade", label: "Trade" },
  { href: "/earn", match: "/earn", label: "Earn" },
  { href: "/leaderboard", match: "/leaderboard", label: "Leaderboard" },
  { href: "/portfolio", match: "/portfolio", label: "Portfolio" },
];

export function Header() {
  const path = usePathname();
  const { connected } = useLive();
  return (
    <>
      <div className="border-b border-line bg-panel/60 px-3 py-1 text-center text-[11px] text-muted">
        <span className="text-warn">●</span> {CHAIN.name} testnet demo · tUSD has no value · GPU prices and news are
        simulated · contracts are unaudited
      </div>
      <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-3">
          <Link href="/trade/H100" className="flex items-center gap-2" aria-label="FLOPS home">
            <Logo />
            <span className="text-[15px] font-bold tracking-[0.18em]">FLOPS</span>
          </Link>
          <nav className="ml-4 hidden items-center gap-1 md:flex">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={
                  "rounded px-3 py-1.5 text-sm transition-colors " +
                  (path.startsWith(n.match) ? "bg-panel-3 text-fg" : "text-muted hover:text-fg")
                }
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span
              title={connected ? "Live price feed connected" : "Price feed disconnected"}
              className={`hidden h-2 w-2 rounded-full sm:block ${connected ? "bg-long" : "animate-pulse bg-short"}`}
            />
            {DEPLOYED && <FaucetButton />}
            {IS_LOCAL && <DevWalletButton />}
            <ConnectButton chainStatus="none" showBalance={false} accountStatus={{ smallScreen: "avatar", largeScreen: "address" }} />
          </div>
        </div>
        <nav className="flex border-t border-line md:hidden">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`flex-1 py-2 text-center text-xs ${path.startsWith(n.match) ? "text-fg" : "text-muted"}`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
    </>
  );
}

function FaucetButton() {
  const { address } = useAccount();
  const { balance } = useTusdBalance();
  const execute = useExecute();
  if (!address) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="num hidden text-xs text-muted lg:inline">{fmtUsd(balance)} tUSD</span>
      <Button
        variant="ghost"
        className="border border-line !px-2.5 !py-1.5 text-xs"
        onClick={() => execute("Claim 10,000 tUSD", [{ ...contracts.tusd, functionName: "faucet" }])}
      >
        Faucet
      </Button>
    </div>
  );
}

function DevWalletButton() {
  const { isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const mock = connectors.find((c) => c.id === "mock");
  useAccountEffect({
    onDisconnect: () => {
      try {
        localStorage.removeItem(DEV_WALLET_KEY);
      } catch {}
    },
  });
  if (isConnected || !mock) return null;
  return (
    <Button
      variant="ghost"
      className="border border-dashed border-line !py-1.5 text-xs"
      title="Local anvil test account — only available on the local chain"
      onClick={() =>
        connect(
          { connector: mock },
          {
            onSuccess: () => {
              try {
                localStorage.setItem(DEV_WALLET_KEY, "1");
              } catch {}
            },
          },
        )
      }
    >
      Dev wallet
    </Button>
  );
}

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="2" y="2" width="20" height="20" rx="4" fill="var(--color-accent)" />
      <path d="M6 15h3v3H6zM10.5 11h3v7h-3zM15 7h3v11h-3z" fill="#0a0c10" />
    </svg>
  );
}
