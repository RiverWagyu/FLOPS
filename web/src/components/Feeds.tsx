"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, type News, type Trade } from "@/lib/api";
import { useLiveEvent } from "@/lib/live";
import { MARKETS } from "@/lib/markets";
import { fmtCompact, fmtPct, fmtPrice, shortAddr, timeAgo } from "@/lib/format";
import { Empty, Panel, PanelHeader } from "./ui";

const KIND: Record<Trade["kind"], string> = { open: "Open", close: "Close", tp: "TP", sl: "SL", liquidation: "Liq" };

/** Re-render every few seconds so relative times stay fresh. */
function useNow(ms = 5000) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

export function TradesFeed({ marketId }: { marketId: number }) {
  useNow();
  const { data = [] } = useQuery({
    queryKey: ["trades", marketId],
    queryFn: () => api<Trade[]>(`/api/trades?market=${marketId}&limit=40`),
  });
  return (
    <Panel className="flex min-h-0 flex-col">
      <PanelHeader>Recent trades</PanelHeader>
      <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-x-2 px-3 py-1.5 text-[11px] text-muted">
        <span>Side</span>
        <span className="text-right">Price</span>
        <span className="text-right">Size</span>
        <span className="w-8 text-right">Age</span>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto pb-2">
        {data.length === 0 && <Empty>No trades yet — be the first</Empty>}
        {data.map((t) => {
          // opening a long or closing a short is a "buy" against the pool
          const buy = t.kind === "open" ? t.isLong : !t.isLong;
          return (
            <li
              key={`${t.tx}-${t.positionId}-${t.kind}`}
              title={`${shortAddr(t.owner)} · ${KIND[t.kind]} ${t.isLong ? "long" : "short"}`}
              className="num grid grid-cols-[1fr_1fr_1fr_auto] gap-x-2 px-3 py-[3px] text-xs"
            >
              <span className={buy ? "text-long" : "text-short"}>
                {KIND[t.kind]} {t.isLong ? "L" : "S"}
                {t.kind === "liquidation" && " ⚡"}
              </span>
              <span className="text-right">{fmtPrice(t.price)}</span>
              <span className="text-right">{fmtCompact(t.size)}</span>
              <span className="w-8 text-right text-muted">{timeAgo(t.ts)}</span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

export function NewsFeed() {
  useNow(15000);
  const { data = [], refetch } = useQuery({ queryKey: ["news"], queryFn: () => api<News[]>("/api/news?limit=12") });
  useLiveEvent((e) => {
    if (e.type === "news") refetch();
  });
  return (
    <Panel className="flex min-h-0 flex-col">
      <PanelHeader right={<span className="text-[10px] text-muted">fictional</span>}>Compute wire</PanelHeader>
      <ul className="min-h-0 flex-1 divide-y divide-line/60 overflow-y-auto">
        {data.length === 0 && <Empty>No news yet</Empty>}
        {data.map((n) => (
          <li key={n.id ?? n.ts} className="px-3 py-2">
            <div className="mb-0.5 flex items-center gap-2 text-[11px]">
              <span className="font-semibold">{MARKETS[n.market]?.symbol}</span>
              <span className={`num ${n.impact > 0 ? "text-long" : "text-short"}`}>{fmtPct(n.impact, 1)}</span>
              <span className="ml-auto text-muted">{timeAgo(n.ts)} ago</span>
            </div>
            <p className="text-xs leading-snug text-fg/85">{n.headline}</p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
