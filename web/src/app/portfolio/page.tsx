"use client";

import { useAccount, useReadContract } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useQuery } from "@tanstack/react-query";
import { contracts } from "@/lib/config";
import { api, type History } from "@/lib/api";
import { useMyPositions, useTusdBalance } from "@/lib/hooks";
import { useExecute } from "@/lib/tx";
import { fmtPct, fmtSigned, fmtUsd, fromWad, tone } from "@/lib/format";
import { Button, Panel, PanelHeader, Stat } from "@/components/ui";
import { HistoryTable, PositionsTable } from "@/components/PositionsPanel";

export default function PortfolioPage() {
  const { address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { balance } = useTusdBalance();
  const { positions } = useMyPositions();
  const execute = useExecute();

  const shares = useReadContract({
    ...contracts.vault,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });
  const lpValue = useReadContract({
    ...contracts.vault,
    functionName: "convertToAssets",
    args: [shares.data ?? 0n],
    query: { enabled: Boolean(shares.data), refetchInterval: 5000 },
  });
  const { data: history } = useQuery({
    queryKey: ["history", address],
    queryFn: () => api<History>(`/api/history?owner=${address}`),
    enabled: Boolean(address),
  });

  if (!address) {
    return (
      <Panel className="mx-auto mt-10 max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold">Your portfolio</h1>
        <p className="mt-2 text-sm text-muted">Connect a wallet to claim test tUSD and start trading GPU-hours.</p>
        <Button variant="accent" className="mt-5" onClick={() => openConnectModal?.()}>
          Connect wallet
        </Button>
      </Panel>
    );
  }

  const inPositions = positions.reduce((s, p) => s + Math.max(0, p.equity), 0);
  const unrealized = positions.reduce((s, p) => s + p.equity - p.collateral, 0);
  const lp = fromWad(lpValue.data);
  const stats = history?.stats;

  return (
    <div className="mx-auto mt-4 flex max-w-6xl flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Portfolio</h1>
        <Button variant="accent" onClick={() => execute("Claim 10,000 tUSD", [{ ...contracts.tusd, functionName: "faucet" }])}>
          Claim 10,000 tUSD
        </Button>
      </div>
      <Panel className="grid grid-cols-2 gap-4 p-4 md:grid-cols-5">
        <Stat label="Net worth" value={`${fmtUsd(balance + inPositions + lp)} tUSD`} />
        <Stat label="Wallet" value={fmtUsd(balance)} />
        <Stat label="In positions" value={fmtUsd(inPositions)} sub={<span className={tone(unrealized)}>{fmtSigned(unrealized)} unrealized</span>} />
        <Stat label="Liquidity (FLP)" value={fmtUsd(lp)} />
        <Stat
          label="Realized PnL"
          value={<span className={tone(stats?.pnl ?? 0)}>{fmtSigned(stats?.pnl ?? 0)}</span>}
          sub={
            stats && stats.trades > 0
              ? `${stats.trades} trade${stats.trades === 1 ? "" : "s"} · ${fmtPct(stats.wins / stats.trades, 0, false)} wins`
              : "no closed trades"
          }
        />
      </Panel>
      <Panel className="overflow-x-auto">
        <PanelHeader>Open positions</PanelHeader>
        <PositionsTable positions={positions} />
      </Panel>
      <Panel className="overflow-x-auto">
        <PanelHeader>Trade history</PanelHeader>
        <HistoryTable owner={address} />
      </Panel>
    </div>
  );
}
