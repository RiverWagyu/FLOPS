"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { contracts } from "@/lib/config";
import { useLive } from "@/lib/live";
import { useImpactDepths, useParams, useTusdBalance } from "@/lib/hooks";
import { useExecute } from "@/lib/tx";
import { fillPrice, liquidationPrice, sizeFor } from "@/lib/math";
import { fmtPct, fmtPrice, fmtUsd, toWad } from "@/lib/format";
import type { MarketMeta } from "@/lib/markets";
import { Button, Panel, Tabs } from "./ui";

const LEV_MARKS = [1, 2, 5, 10, 25, 50];

export function OrderPanel({ market }: { market: MarketMeta }) {
  const { address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { markets, keeper } = useLive();
  const params = useParams();
  const depths = useImpactDepths();
  const { balance } = useTusdBalance();
  const execute = useExecute();

  const [isLong, setIsLong] = useState(true);
  const [type, setType] = useState<"market" | "limit">("market");
  const [collateralStr, setCollateral] = useState("100");
  const [leverage, setLeverage] = useState(10);
  const [triggerStr, setTrigger] = useState("");
  const [tpsl, setTpsl] = useState(false);
  const [tpStr, setTp] = useState("");
  const [slStr, setSl] = useState("");
  const [busy, setBusy] = useState(false);

  const m = markets[market.id];
  const index = m?.price ?? 0;
  const collateral = Number(collateralStr) || 0;
  const size = sizeFor(collateral, leverage, params);
  const openFee = (size * params.openFeeBps) / 1e4;
  const margin = collateral - openFee;
  const trigger = Number(triggerStr) || 0;
  const tp = tpsl ? Number(tpStr) || 0 : 0;
  const sl = tpsl ? Number(slStr) || 0 : 0;
  const ref = type === "limit" ? trigger : index;
  const entry = ref > 0 ? fillPrice(ref, size, depths[market.id] ?? 1e8, isLong) : 0;
  const liq = liquidationPrice({ isLong, size, margin, entry, p: params });
  const execFees = (type === "limit" ? params.executionFee : 0) + (tp || sl ? params.executionFee : 0);
  const totalCost = collateral + execFees;
  const capacity = isLong ? m?.longCapacity : m?.shortCapacity;

  let error = "";
  if (!m) error = "Waiting for price feed…";
  else if (keeper?.lowGas && type === "market") error = "Trading paused: keeper out of gas";
  else if (collateral < params.minCollateral) error = `Minimum collateral is ${params.minCollateral} tUSD`;
  else if (address && totalCost > balance) error = "Insufficient tUSD — use the faucet";
  else if (m.maxPositionSize > 0 && size > m.maxPositionSize) error = `Max position size is ${fmtUsd(m.maxPositionSize, 0)}`;
  else if (capacity !== undefined && m.maxPositionSize > 0 && size > capacity) error = "Open-interest cap reached on this side";
  else if (type === "limit" && !(trigger > 0)) error = "Enter a limit price";
  else if (tp && (isLong ? tp <= ref : tp >= ref)) error = `Take-profit must be ${isLong ? "above" : "below"} entry`;
  else if (sl && (isLong ? sl >= ref : sl <= ref)) error = `Stop-loss must be ${isLong ? "below" : "above"} entry`;

  async function submit() {
    if (!address) return openConnectModal?.();
    setBusy(true);
    const c = toWad(collateral);
    const s = toWad(size);
    const label = `${type === "limit" ? "Limit " : ""}${isLong ? "Long" : "Short"} ${market.symbol} ${leverage}x`;
    const call =
      type === "market"
        ? { ...contracts.perps, functionName: "openPosition", args: [BigInt(market.id), isLong, c, s, toWad(tp), toWad(sl)] }
        : { ...contracts.perps, functionName: "placeOrder", args: [BigInt(market.id), isLong, c, s, toWad(trigger), toWad(tp), toWad(sl)] };
    // Exactly what the contract pulls: collateral + one execution fee per keeper action
    // (limit fill, TP/SL). Computed in wei so the exact-amount approval is never 1 wei short.
    const keeperActions = BigInt((type === "limit" ? 1 : 0) + (tp || sl ? 1 : 0));
    const amount = c + toWad(params.executionFee) * keeperActions;
    // Market orders fill at the on-chain price right away, so refresh it first; limit orders don't.
    await execute(label, [call as any], { spender: contracts.perps.address, amount, freshPrice: type === "market" });
    setBusy(false);
  }

  const pct = (p: number) => (ref > 0 && p > 0 ? (p / ref - 1) * (isLong ? 1 : -1) * leverage : undefined);

  return (
    <Panel className="flex flex-col">
      <div className="grid grid-cols-2 gap-1 p-2">
        <button
          onClick={() => setIsLong(true)}
          className={`rounded py-2 text-sm font-semibold transition ${isLong ? "bg-long text-black" : "bg-panel-3 text-muted hover:text-fg"}`}
        >
          Long
        </button>
        <button
          onClick={() => setIsLong(false)}
          className={`rounded py-2 text-sm font-semibold transition ${!isLong ? "bg-short text-white" : "bg-panel-3 text-muted hover:text-fg"}`}
        >
          Short
        </button>
      </div>
      <div className="px-3">
        <Tabs
          value={type}
          onChange={setType}
          items={[
            { value: "market", label: "Market" },
            { value: "limit", label: "Limit" },
          ]}
        />
      </div>

      <div className="flex flex-col gap-3 p-3">
        {type === "limit" && (
          <Field
            label="Limit price"
            hint={isLong ? "fills at or below" : "fills at or above"}
            value={triggerStr}
            onChange={setTrigger}
            suffix="tUSD/h"
            placeholder={fmtPrice(index)}
          />
        )}
        <Field
          label="Collateral"
          hint={address ? `balance ${fmtUsd(balance)}` : undefined}
          onHint={() => setCollateral(String(Math.floor(Math.max(0, balance - 2))))}
          value={collateralStr}
          onChange={setCollateral}
          suffix="tUSD"
        />

        <div>
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <label htmlFor="lev" className="text-muted">
              Leverage
            </label>
            <span className="num font-semibold">{leverage}x</span>
          </div>
          <input
            id="lev"
            type="range"
            min={1}
            max={params.maxLeverage}
            step={1}
            value={leverage}
            onChange={(e) => setLeverage(Number(e.target.value))}
            className="w-full"
          />
          <div className="mt-1 flex justify-between">
            {LEV_MARKS.filter((l) => l <= params.maxLeverage).map((l) => (
              <button
                key={l}
                onClick={() => setLeverage(l)}
                className={`num rounded px-1.5 py-0.5 text-[11px] ${leverage === l ? "bg-panel-3 text-fg" : "text-muted hover:text-fg"}`}
              >
                {l}x
              </button>
            ))}
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={tpsl} onChange={(e) => setTpsl(e.target.checked)} className="accent-[var(--color-accent)]" />
          Take-profit / Stop-loss
          <span className="ml-auto">+{params.executionFee} tUSD keeper fee</span>
        </label>
        {tpsl && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Take-profit" value={tpStr} onChange={setTp} hint={pct(tp) !== undefined ? fmtPct(pct(tp), 0) : undefined} />
            <Field label="Stop-loss" value={slStr} onChange={setSl} hint={pct(sl) !== undefined ? fmtPct(pct(sl), 0) : undefined} />
          </div>
        )}

        <Button
          variant={isLong ? "long" : "short"}
          className="mt-1 w-full py-2.5"
          disabled={busy || (Boolean(address) && Boolean(error))}
          onClick={submit}
        >
          {!address
            ? "Connect wallet"
            : busy
              ? "Submitting…"
              : `${type === "limit" ? "Place limit " : ""}${isLong ? "Long" : "Short"} ${market.symbol}`}
        </Button>
        {address && error && <p className="-mt-1 text-center text-xs text-warn">{error}</p>}

        <dl className="num space-y-1.5 border-t border-line pt-3 text-xs">
          <Row k="Position size" v={`${fmtUsd(size)} tUSD`} />
          <Row k="GPU-hours" v={entry > 0 ? fmtUsd(size / entry, 1) : "—"} />
          <Row k={type === "limit" ? "Est. fill price" : "Est. entry price"} v={fmtPrice(entry)} />
          <Row k="Liquidation price" v={<span className="text-warn">{fmtPrice(liq)}</span>} />
          <Row k="Open fee (0.1%)" v={`${fmtUsd(openFee)} tUSD`} />
          {execFees > 0 && <Row k="Keeper fees" v={`${fmtUsd(execFees)} tUSD`} />}
          <Row k="Price impact" v={fmtPct(Math.min(size / (depths[market.id] ?? 1e8), 0.01), 3, false)} />
          <Row k="Available liquidity" v={capacity !== undefined ? `${fmtUsd(capacity, 0)}` : "—"} />
        </dl>
      </div>
    </Panel>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="font-sans text-muted">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  suffix,
  hint,
  onHint,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
  hint?: string;
  onHint?: () => void;
  placeholder?: string;
}) {
  const id = `f-${label.replace(/\W/g, "")}`;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <label htmlFor={id} className="text-muted">
          {label}
        </label>
        {hint &&
          (onHint ? (
            <button onClick={onHint} className="num text-muted hover:text-fg">
              {hint}
            </button>
          ) : (
            <span className="num text-muted">{hint}</span>
          ))}
      </div>
      <div className="flex items-center rounded border border-line bg-panel-2 focus-within:border-accent">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min="0"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="num w-full min-w-0 bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted/50"
        />
        {suffix && <span className="pr-2.5 text-xs text-muted">{suffix}</span>}
      </div>
    </div>
  );
}
