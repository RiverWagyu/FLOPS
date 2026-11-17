"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useLive } from "@/lib/live";
import { MARKETS, type MarketMeta } from "@/lib/markets";
import { fmtCompact, fmtPct, fmtPrice, tone } from "@/lib/format";
import { Stat } from "./ui";

export function MarketBar({ market }: { market: MarketMeta }) {
  const { markets } = useLive();
  const m = markets[market.id];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1 overflow-x-auto">
        {MARKETS.map((mk) => {
          const s = markets[mk.id];
          const active = mk.id === market.id;
          return (
            <Link
              key={mk.id}
              href={`/trade/${mk.symbol}`}
              className={
                "flex min-w-[168px] flex-1 items-center justify-between gap-3 whitespace-nowrap rounded-md border px-3 py-2 transition-colors " +
                (active ? "border-accent/60 bg-panel-2" : "border-line bg-panel hover:bg-panel-2")
              }
            >
              <div>
                <div className="text-sm font-semibold">{mk.symbol}-PERP</div>
                <div className="text-[11px] text-muted">{mk.vram}</div>
              </div>
              <div className="text-right">
                <div className="num text-sm">{fmtPrice(s?.price)}</div>
                <div className={`num text-[11px] ${tone(s?.change24h ?? 0)}`}>{fmtPct(s?.change24h)}</div>
              </div>
            </Link>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-line bg-panel px-3 py-2">
        <div>
          <div className="text-sm font-semibold">{market.name}</div>
          <div className="text-[11px] text-muted">tUSD per GPU-hour · {market.tier}</div>
        </div>
        <LivePrice price={m?.price} />
        <Stat label="24h change" value={<span className={tone(m?.change24h ?? 0)}>{fmtPct(m?.change24h)}</span>} />
        <Stat label="24h high" value={fmtPrice(m?.high24h)} />
        <Stat label="24h low" value={fmtPrice(m?.low24h)} />
        <Stat label="24h volume" value={`${fmtCompact(m?.volume24h)}`} />
        <Stat
          label="Open interest (L / S)"
          value={
            <>
              <span className="text-long">{fmtCompact(m?.longOI)}</span> / <span className="text-short">{fmtCompact(m?.shortOI)}</span>
            </>
          }
        />
        <Stat
          label="Funding / hour"
          value={
            <span className={tone(-(m?.fundingRatePerHour ?? 0))}>
              {fmtPct(m?.fundingRatePerHour, 4, false)}
            </span>
          }
          sub={m && m.fundingRatePerHour !== 0 ? (m.fundingRatePerHour > 0 ? "longs pay shorts" : "shorts pay longs") : "balanced"}
        />
      </div>
    </div>
  );
}

function LivePrice({ price }: { price?: number }) {
  const prev = useRef(price);
  const [flash, setFlash] = useState("");
  useEffect(() => {
    if (price === undefined || prev.current === undefined) {
      prev.current = price;
      return;
    }
    if (price !== prev.current) setFlash(price > prev.current ? "flash-up text-long" : "flash-down text-short");
    prev.current = price;
    const t = setTimeout(() => setFlash(""), 800);
    return () => clearTimeout(t);
  }, [price]);
  return (
    <div className={`num rounded px-1 text-xl font-semibold ${flash}`} aria-live="off">
      {fmtPrice(price)}
    </div>
  );
}
