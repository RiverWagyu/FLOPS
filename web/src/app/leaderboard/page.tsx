"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { api, type LeaderRow } from "@/lib/api";
import { MARKETS } from "@/lib/markets";
import { fmtPct, fmtPrice, fmtSigned, fmtUsd, shortAddr, timeAgo, tone } from "@/lib/format";
import { Empty, Panel, PanelHeader, SideBadge, Tabs } from "@/components/ui";

type Liq = { positionId: number; owner: string; market: number; isLong: boolean; size: number; collateral: number; price: number; ts: number };

export default function LeaderboardPage() {
  const [type, setType] = useState<"pnl" | "roi">("pnl");
  const { address } = useAccount();
  const me = address?.toLowerCase();
  const { data: rows } = useQuery({
    queryKey: ["leaderboard", type],
    queryFn: () => api<LeaderRow[]>(`/api/leaderboard?type=${type}`),
    refetchInterval: 15_000,
  });
  const { data: liqs = [] } = useQuery({
    queryKey: ["trades", "liquidations"],
    queryFn: () => api<Liq[]>("/api/liquidations?limit=25"),
    refetchInterval: 15_000,
  });

  return (
    <div className="mx-auto mt-4 grid max-w-6xl gap-3 lg:grid-cols-[1fr_340px]">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold">Leaderboard</h1>
            <p className="mt-1 text-sm text-muted">
              Ranked on closed trades only. Faucet claims never count.
              {type === "roi" && " ROI requires at least 100 tUSD of total margin used."}
            </p>
          </div>
          <Tabs
            value={type}
            onChange={setType}
            items={[
              { value: "pnl", label: "Realized PnL" },
              { value: "roi", label: "ROI" },
            ]}
          />
        </div>
        <Panel className="overflow-x-auto">
          {!rows ? (
            <Empty>Loading…</Empty>
          ) : rows.length === 0 ? (
            <Empty>No closed trades yet</Empty>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-line text-left text-[11px] text-muted">
                  {["#", "Trader", "Realized PnL", "ROI", "Trades", "Win rate", "Liquidations"].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.owner} className={`num border-b border-line/60 text-xs ${r.owner === me ? "bg-accent/10" : ""}`}>
                    <td className="px-3 py-2 text-muted">{i < 3 ? ["🥇", "🥈", "🥉"][i] : i + 1}</td>
                    <td className="px-3 py-2">
                      {shortAddr(r.owner)}
                      {r.owner === me && <span className="ml-2 rounded bg-accent/30 px-1 font-sans text-[10px]">you</span>}
                    </td>
                    <td className={`px-3 py-2 ${tone(r.pnl)} ${type === "pnl" ? "font-semibold" : ""}`}>{fmtSigned(r.pnl)}</td>
                    <td className={`px-3 py-2 ${tone(r.roi)} ${type === "roi" ? "font-semibold" : ""}`}>{fmtPct(r.roi, 1)}</td>
                    <td className="px-3 py-2">{r.trades}</td>
                    <td className="px-3 py-2">{fmtPct(r.trades ? r.wins / r.trades : 0, 0, false)}</td>
                    <td className="px-3 py-2 text-muted">{r.liquidations}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
      <Panel className="flex max-h-[640px] flex-col self-start">
        <PanelHeader>Recent liquidations</PanelHeader>
        <ul className="divide-y divide-line/60 overflow-y-auto">
          {liqs.length === 0 && <Empty>Nobody has been liquidated yet</Empty>}
          {liqs.map((l) => (
            <li key={l.positionId} className="flex items-center gap-3 px-3 py-2 text-xs">
              <span className="text-short">⚡</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{MARKETS[l.market]?.symbol}</span>
                  <SideBadge isLong={l.isLong} lev={l.size / l.collateral} />
                </div>
                <div className="num text-[11px] text-muted">
                  {shortAddr(l.owner)} · {fmtUsd(l.size, 0)} @ {fmtPrice(l.price)}
                </div>
              </div>
              <div className="text-right">
                <div className="num text-short">−{fmtUsd(l.collateral)}</div>
                <div className="text-[11px] text-muted">{timeAgo(l.ts)} ago</div>
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
