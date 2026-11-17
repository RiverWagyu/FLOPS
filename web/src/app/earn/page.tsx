"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useQuery } from "@tanstack/react-query";
import { AreaSeries, ColorType, createChart, type UTCTimestamp } from "lightweight-charts";
import { contracts } from "@/lib/config";
import { api, type PoolInfo } from "@/lib/api";
import { useTusdBalance } from "@/lib/hooks";
import { useExecute } from "@/lib/tx";
import { fmtCompact, fmtPct, fmtUsd, fromWad, toWad } from "@/lib/format";
import { Button, Panel, PanelHeader, Stat, Tabs } from "@/components/ui";
import { AddTokenButton } from "@/components/AddToken";

export default function EarnPage() {
  const { data: pool } = useQuery({ queryKey: ["pool"], queryFn: () => api<PoolInfo>("/api/pool"), refetchInterval: 10_000 });
  return (
    <div className="mx-auto mt-4 flex max-w-5xl flex-col gap-3">
      <div>
        <h1 className="text-xl font-semibold">Provide liquidity</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Deposit tUSD into the FLOPS pool and receive FLP. The pool is the counterparty to every trade: it earns trading fees and
          trader losses, and pays out trader profits. FLP is worth more when traders lose and less when they win.
        </p>
      </div>
      <Panel className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
        <Stat label="Pool value (TVL)" value={`${fmtCompact(pool?.totalAssets)} tUSD`} />
        <Stat label="FLP price" value={pool ? fmtUsd(pool.sharePrice, 4) : "—"} />
        <Stat label="APR (7d, annualized)" value={<span className={pool && pool.apr >= 0 ? "text-long" : "text-short"}>{fmtPct(pool?.apr)}</span>} />
        <Stat label="Utilization" value={fmtPct(pool?.utilization, 1, false)} sub={`${fmtCompact(pool?.openInterest)} open interest`} />
      </Panel>
      <div className="grid gap-3 md:grid-cols-[1fr_360px]">
        <Panel className="flex h-[360px] flex-col">
          <PanelHeader>FLP price</PanelHeader>
          <SharePriceChart history={pool?.history ?? []} />
        </Panel>
        <LpForm />
      </div>
      <Panel className="p-4 text-xs leading-relaxed text-muted">
        <h2 className="mb-2 text-sm font-semibold text-fg">How the pool stays solvent</h2>
        <ul className="list-disc space-y-1 pl-4">
          <li>Each side of each market is capped at 30% of the pool, and one position at 5%.</li>
          <li>Liquidity that backs open positions can&apos;t be withdrawn until those positions shrink.</li>
          <li>Positions are liquidated by the keeper (or anyone) once equity drops below 1% of size.</li>
        </ul>
      </Panel>
    </div>
  );
}

function LpForm() {
  const { address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { balance } = useTusdBalance();
  const execute = useExecute();
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");

  const shares = useReadContract({
    ...contracts.vault,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address), refetchInterval: 4000 },
  });
  const value = useReadContract({
    ...contracts.vault,
    functionName: "convertToAssets",
    args: [shares.data ?? 0n],
    query: { enabled: Boolean(shares.data), refetchInterval: 4000 },
  });
  const maxW = useReadContract({
    ...contracts.vault,
    functionName: "maxWithdraw",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address), refetchInterval: 4000 },
  });

  const myValue = fromWad(value.data);
  const withdrawable = fromWad(maxW.data);
  const amt = Number(amount) || 0;
  const max = mode === "deposit" ? balance : withdrawable;
  const error = amt <= 0 ? "" : amt > max + 1e-9 ? (mode === "deposit" ? "Insufficient tUSD" : "Exceeds withdrawable amount") : "";

  async function submit() {
    if (!address) return openConnectModal?.();
    let ok: boolean;
    if (mode === "deposit") {
      ok = await execute(
        `Deposit ${fmtUsd(amt)} tUSD`,
        [{ ...contracts.vault, functionName: "deposit", args: [toWad(amt), address] }],
        { spender: contracts.vault.address, amount: toWad(amt) },
      );
    } else {
      const all = withdrawable > 0 && Math.abs(amt - withdrawable) < 1e-6 && Math.abs(withdrawable - myValue) < 1e-6;
      ok = await execute(
        `Withdraw ${fmtUsd(amt)} tUSD`,
        all
          ? [{ ...contracts.vault, functionName: "redeem", args: [shares.data ?? 0n, address, address] }]
          : [{ ...contracts.vault, functionName: "withdraw", args: [toWad(amt), address, address] }],
      );
    }
    if (ok) setAmount("");
  }

  return (
    <Panel className="flex flex-col">
      <div className="border-b border-line p-2">
        <Tabs
          value={mode}
          onChange={(v) => {
            setMode(v);
            setAmount("");
          }}
          items={[
            { value: "deposit", label: "Deposit" },
            { value: "withdraw", label: "Withdraw" },
          ]}
        />
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Your FLP value" value={`${fmtUsd(myValue)} tUSD`} />
          <Stat label="Withdrawable now" value={`${fmtUsd(withdrawable)} tUSD`} />
        </div>
        <AddTokenButton token="FLP" className="-ml-2 self-start" />
        <div>
          <div className="mb-1 flex justify-between text-xs">
            <label htmlFor="lp-amt" className="text-muted">
              Amount
            </label>
            <button className="num text-muted hover:text-fg" onClick={() => setAmount(String(Math.floor(max * 100) / 100))}>
              max {fmtUsd(max)}
            </button>
          </div>
          <div className="flex items-center rounded border border-line bg-panel-2 focus-within:border-accent">
            <input
              id="lp-amt"
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="num w-full bg-transparent px-2.5 py-2 text-sm outline-none"
            />
            <span className="pr-2.5 text-xs text-muted">tUSD</span>
          </div>
        </div>
        <Button variant="accent" className="mt-auto w-full" disabled={Boolean(address) && (amt <= 0 || Boolean(error))} onClick={submit}>
          {!address ? "Connect wallet" : mode === "deposit" ? "Deposit" : "Withdraw"}
        </Button>
        {error && <p className="-mt-1 text-center text-xs text-warn">{error}</p>}
      </div>
    </Panel>
  );
}

function SharePriceChart({ history }: { history: PoolInfo["history"] }) {
  const el = useRef<HTMLDivElement>(null);
  const series = useRef<ReturnType<ReturnType<typeof createChart>["addSeries"]> | null>(null);
  useEffect(() => {
    if (!el.current) return;
    const c = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#7d8794", fontSize: 11, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: "#161b22" } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true },
    });
    series.current = c.addSeries(AreaSeries, {
      lineColor: "#7b61ff",
      topColor: "rgba(123,97,255,0.25)",
      bottomColor: "rgba(123,97,255,0)",
      lineWidth: 2,
      priceFormat: { type: "price", precision: 5, minMove: 0.00001 },
    });
    return () => c.remove();
  }, []);
  useEffect(() => {
    const seen = new Set<number>();
    const data = history
      .map((h) => ({ time: Math.floor(h.ts / 1000) as UTCTimestamp, value: h.sharePrice }))
      .filter((d) => !seen.has(d.time) && seen.add(d.time));
    series.current?.setData(data);
  }, [history]);
  return (
    <div className="relative min-h-0 flex-1">
      <div ref={el} className="absolute inset-0" />
      {history.length < 2 && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted">History builds up as the pool runs</div>
      )}
    </div>
  );
}
