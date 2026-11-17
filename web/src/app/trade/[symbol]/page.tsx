"use client";

import { use } from "react";
import { notFound } from "next/navigation";
import { marketBySymbol } from "@/lib/markets";
import { useMyOrders, useMyPositions } from "@/lib/hooks";
import { DEPLOYED } from "@/lib/config";
import { MarketBar } from "@/components/MarketBar";
import { Chart, type ChartLine } from "@/components/Chart";
import { OrderPanel } from "@/components/OrderPanel";
import { PositionsPanel } from "@/components/PositionsPanel";
import { NewsFeed, TradesFeed } from "@/components/Feeds";
import { Panel } from "@/components/ui";

export default function TradePage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = use(params);
  const market = marketBySymbol(symbol);
  if (!market) notFound();

  const { positions } = useMyPositions();
  const orders = useMyOrders();
  const lines: ChartLine[] = [
    ...positions
      .filter((p) => p.marketId === market.id)
      .flatMap((p) => [
        { price: p.entryPrice, color: p.isLong ? "#2fbf8a" : "#f0506e", title: `${p.isLong ? "L" : "S"} entry` },
        { price: p.liquidationPrice, color: "#f5b84b", title: "liq" },
      ]),
    ...orders
      .filter((o) => o.marketId === market.id)
      .map((o) => ({ price: o.triggerPrice, color: "#7b61ff", title: `limit ${o.isLong ? "L" : "S"}` })),
  ];

  if (!DEPLOYED) {
    return (
      <Panel className="mt-6 p-6 text-sm text-muted">
        Contracts are not deployed for this chain yet. Run the deploy script and <code>npm run abi</code>.
      </Panel>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      <MarketBar market={market} />
      <div className="grid gap-2 lg:grid-cols-[1fr_300px] xl:grid-cols-[1fr_260px_320px]">
        <Panel className="h-[460px] overflow-hidden lg:h-[540px]">
          <Chart marketId={market.id} lines={lines} />
        </Panel>
        <div className="hidden h-[540px] flex-col gap-2 xl:flex">
          <div className="flex min-h-0 flex-[3] flex-col">
            <TradesFeed marketId={market.id} />
          </div>
          <div className="flex min-h-0 flex-[2] flex-col">
            <NewsFeed />
          </div>
        </div>
        <div className="lg:row-span-2 xl:row-span-1">
          <OrderPanel market={market} />
        </div>
        <div className="lg:col-start-1 xl:col-span-2">
          <PositionsPanel marketFilter={market.id} />
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:hidden">
        <div className="flex h-80 flex-col">
          <TradesFeed marketId={market.id} />
        </div>
        <div className="flex h-80 flex-col">
          <NewsFeed />
        </div>
      </div>
    </div>
  );
}
