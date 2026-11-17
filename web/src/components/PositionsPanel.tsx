"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { contracts, EXPLORER } from "@/lib/config";
import { useLive } from "@/lib/live";
import { useMyOrders, useMyPositions, useParams, type LivePosition } from "@/lib/hooks";
import { useExecute } from "@/lib/tx";
import { api, type History } from "@/lib/api";
import { MARKETS } from "@/lib/markets";
import { fmtPct, fmtPrice, fmtSigned, fmtUsd, timeAgo, toWad, tone } from "@/lib/format";
import { Button, Empty, Panel, SideBadge, Tabs } from "./ui";

const REASON = ["Closed", "Take-profit", "Stop-loss", "Liquidated"];

export function PositionsPanel({ marketFilter }: { marketFilter?: number }) {
  const [tab, setTab] = useState<"positions" | "orders" | "history">("positions");
  const { address } = useAccount();
  const { positions } = useMyPositions();
  const orders = useMyOrders();
  return (
    <Panel>
      <div className="flex h-10 items-center border-b border-line px-2">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: "positions", label: `Positions (${positions.length})` },
            { value: "orders", label: `Orders (${orders.length})` },
            { value: "history", label: "History" },
          ]}
        />
      </div>
      <div className="overflow-x-auto">
        {!address ? (
          <Empty>Connect a wallet to see your positions</Empty>
        ) : tab === "positions" ? (
          <PositionsTable positions={positions} highlight={marketFilter} />
        ) : tab === "orders" ? (
          <OrdersTable orders={orders} />
        ) : (
          <HistoryTable owner={address} />
        )}
      </div>
    </Panel>
  );
}

const th = "px-3 py-2 text-left text-[11px] font-medium text-muted whitespace-nowrap";
const td = "num px-3 py-2 text-xs whitespace-nowrap";

export function PositionsTable({ positions, highlight }: { positions: LivePosition[]; highlight?: number }) {
  const { markets } = useLive();
  const execute = useExecute();
  const [editing, setEditing] = useState<bigint | null>(null);
  if (positions.length === 0) return <Empty>No open positions</Empty>;
  return (
    <table className="w-full">
      <thead>
        <tr className="border-b border-line">
          {["Market", "Size", "Entry", "Mark", "Liq. price", "Margin", "PnL", "TP / SL", ""].map((h) => (
            <th key={h} className={th}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {positions.map((p) => {
          const mark = markets[p.marketId]?.price ?? 0;
          const net = p.equity - p.collateral;
          const lev = p.size / p.margin;
          return (
            <tr key={String(p.id)} className={`border-b border-line/60 ${highlight === p.marketId ? "bg-panel-2/50" : ""}`}>
              <td className={td}>
                <div className="font-sans font-semibold">{MARKETS[p.marketId]?.symbol}</div>
                <SideBadge isLong={p.isLong} lev={lev} />
              </td>
              <td className={td}>{fmtUsd(p.size)}</td>
              <td className={td}>{fmtPrice(p.entryPrice)}</td>
              <td className={td}>{fmtPrice(mark)}</td>
              <td className={`${td} ${p.liquidatable ? "text-short" : "text-warn"}`}>
                {fmtPrice(p.liquidationPrice)}
                {p.liquidatable && <div className="text-[10px]">liquidating…</div>}
              </td>
              <td className={td}>
                {fmtUsd(p.margin)}
                <div className={`text-[10px] ${tone(-p.funding)}`}>funding {fmtSigned(-p.funding, 3)}</div>
              </td>
              <td className={`${td} ${tone(net)}`}>
                {fmtSigned(net)}
                <div className="text-[10px]">{fmtPct(net / p.collateral)}</div>
              </td>
              <td className={td}>
                {editing === p.id ? (
                  <TpSlEditor p={p} onDone={() => setEditing(null)} />
                ) : (
                  <button onClick={() => setEditing(p.id)} className="text-left hover:text-accent" title="Edit TP / SL">
                    <span className="text-long">{p.tp ? fmtPrice(p.tp) : "—"}</span> /{" "}
                    <span className="text-short">{p.sl ? fmtPrice(p.sl) : "—"}</span> ✎
                  </button>
                )}
              </td>
              <td className={`${td} text-right`}>
                <Button
                  className="!px-2.5 !py-1 text-xs"
                  onClick={() =>
                    execute(
                      `Close ${MARKETS[p.marketId]?.symbol} ${p.isLong ? "long" : "short"}`,
                      [{ ...contracts.perps, functionName: "closePosition", args: [p.id] }],
                      { freshPrice: true },
                    )
                  }
                >
                  Close
                </Button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function TpSlEditor({ p, onDone }: { p: LivePosition; onDone: () => void }) {
  const [tp, setTp] = useState(p.tp ? String(p.tp) : "");
  const [sl, setSl] = useState(p.sl ? String(p.sl) : "");
  const execute = useExecute();
  const params = useParams();
  const save = async () => {
    const ok = await execute(
      "Update TP / SL",
      [{ ...contracts.perps, functionName: "setTpSl", args: [p.id, toWad(Number(tp) || 0), toWad(Number(sl) || 0)] }],
      { spender: contracts.perps.address, amount: p.tp || p.sl ? 0n : toWad(params.executionFee) },
    );
    if (ok) onDone();
  };
  const input = "num w-20 rounded border border-line bg-panel-2 px-1.5 py-1 text-xs outline-none focus:border-accent";
  return (
    <div className="flex items-center gap-1">
      <input aria-label="Take-profit price" className={input} placeholder="TP" value={tp} onChange={(e) => setTp(e.target.value)} />
      <input aria-label="Stop-loss price" className={input} placeholder="SL" value={sl} onChange={(e) => setSl(e.target.value)} />
      <Button variant="accent" className="!px-2 !py-1 text-xs" onClick={save}>
        Save
      </Button>
      <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={onDone}>
        ×
      </Button>
    </div>
  );
}

function OrdersTable({ orders }: { orders: ReturnType<typeof useMyOrders> }) {
  const execute = useExecute();
  const { markets } = useLive();
  if (orders.length === 0) return <Empty>No open orders</Empty>;
  return (
    <table className="w-full">
      <thead>
        <tr className="border-b border-line">
          {["Market", "Type", "Trigger", "Mark", "Size", "Collateral", "TP / SL", ""].map((h) => (
            <th key={h} className={th}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {orders.map((o) => (
          <tr key={String(o.id)} className="border-b border-line/60">
            <td className={td}>
              <div className="font-sans font-semibold">{MARKETS[o.marketId]?.symbol}</div>
              <SideBadge isLong={o.isLong} lev={o.size / o.collateral} />
            </td>
            <td className={`${td} font-sans text-muted`}>Limit {o.isLong ? "≤" : "≥"}</td>
            <td className={td}>{fmtPrice(o.triggerPrice)}</td>
            <td className={td}>{fmtPrice(markets[o.marketId]?.price)}</td>
            <td className={td}>{fmtUsd(o.size)}</td>
            <td className={td}>{fmtUsd(o.collateral)}</td>
            <td className={td}>
              {o.tp ? fmtPrice(o.tp) : "—"} / {o.sl ? fmtPrice(o.sl) : "—"}
            </td>
            <td className={`${td} text-right`}>
              <Button
                className="!px-2.5 !py-1 text-xs"
                onClick={() => execute("Cancel order", [{ ...contracts.perps, functionName: "cancelOrder", args: [o.id] }])}
              >
                Cancel
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function HistoryTable({ owner }: { owner: string }) {
  const { data } = useQuery({
    queryKey: ["history", owner],
    queryFn: () => api<History>(`/api/history?owner=${owner}`),
    refetchInterval: 10_000,
  });
  if (!data) return <Empty>Loading…</Empty>;
  if (data.positions.length === 0) return <Empty>No closed trades yet</Empty>;
  return (
    <table className="w-full">
      <thead>
        <tr className="border-b border-line">
          {["Closed", "Market", "Size", "Entry → Exit", "Funding", "Fees", "Realized PnL", "Result"].map((h) => (
            <th key={h} className={th}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.positions.map((p) => (
          <tr key={p.id} className="border-b border-line/60">
            <td className={`${td} text-muted`}>{timeAgo(p.closedAt)} ago</td>
            <td className={td}>
              <span className="mr-2 font-sans font-semibold">{MARKETS[p.market]?.symbol}</span>
              <SideBadge isLong={p.isLong} />
            </td>
            <td className={td}>{fmtUsd(p.size)}</td>
            <td className={td}>
              {fmtPrice(p.entryPrice)} → {fmtPrice(p.exitPrice)}
            </td>
            <td className={`${td} ${tone(-p.funding)}`}>{fmtSigned(-p.funding, 3)}</td>
            <td className={td}>{fmtUsd(p.fees)}</td>
            <td className={`${td} ${tone(p.realized)}`}>
              {fmtSigned(p.realized)} <span className="text-[10px]">({fmtPct(p.realized / p.collateral)})</span>
            </td>
            <td className={`${td} font-sans`}>
              {EXPLORER ? (
                <a href={`${EXPLORER}/tx/${p.tx}`} target="_blank" rel="noreferrer" className={p.reason === 3 ? "text-short" : "text-muted hover:text-fg"}>
                  {REASON[p.reason]} ↗
                </a>
              ) : (
                <span className={p.reason === 3 ? "text-short" : "text-muted"}>{REASON[p.reason]}</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
