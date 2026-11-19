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
import { GettingStarted, OPEN_GUIDE_EVENT } from "./GettingStarted";

const NAV = [
  { href: "/trade/H100", match: "/trade", label: "Trade" },
  { href: "/markets", match: "/markets", label: "Markets" },
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
      <KeeperBanner />
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
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event(OPEN_GUIDE_EVENT))}
              className="hidden rounded px-2 py-1.5 text-xs text-muted hover:text-fg sm:block"
              title="Open the getting-started guide"
            >
              Guide
            </button>
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
      <GettingStarted />
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

/** The FLOPS mark: GPU cores lighting up as a rising chart; the green core is the live price. */
const MARK = ["...g", "..pp", ".ppp", "pppp"];

function Logo() {
  const fill = { ".": "var(--color-line)", p: "var(--color-accent)", g: "var(--color-long)" } as const;
  return (
    <svg width="24" height="24" viewBox="0 0 40 40" aria-hidden>
      {MARK.flatMap((row, r) =>
        [...row].map((ch, c) => (
          <rect
            key={`${r}${c}`}
            x={c * 10.5}
            y={r * 10.5}
            width="8.5"
            height="8.5"
            rx="2"
            fill={fill[ch as keyof typeof fill]}
          />
        )),
      )}
    </svg>
  );
}

/** Shown when the keeper can't afford to post prices: opening and closing are paused until it's funded. */
function KeeperBanner() {
  const { keeper } = useLive();
  if (!keeper?.lowGas) return null;
  return (
    <div role="alert" className="border-b border-short/40 bg-short/10 px-3 py-1.5 text-center text-xs text-fg">
      <span className="font-semibold text-short">Trading paused:</span> the price keeper is out of test ETH, so
      positions can&apos;t be opened or closed right now. Funds are safe. Send {CHAIN.name} ETH to{" "}
      <a
        className="num underline decoration-dotted"
        href={`${CHAIN.blockExplorers?.default.url ?? ""}/address/${keeper.address}`}
        target="_blank"
        rel="noreferrer"
      >
        {keeper.address.slice(0, 6)}…{keeper.address.slice(-4)}
      </a>{" "}
      to resume.
    </div>
  );
}
