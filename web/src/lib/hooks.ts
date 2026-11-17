"use client";

import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { contracts } from "./config";
import { fromWad } from "./format";
import { DEFAULT_PARAMS, type Params } from "./math";

export function useParams(): Params {
  const keys = ["openFeeBps", "closeFeeBps", "executionFee", "maxLeverage", "maintenanceBps", "minCollateral"] as const;
  const { data } = useReadContracts({
    contracts: keys.map((functionName) => ({ ...contracts.perps, functionName })),
    query: { staleTime: 60_000 },
  });
  if (!data || data.some((d) => d.status !== "success")) return DEFAULT_PARAMS;
  const v = data.map((d) => d.result as bigint);
  return {
    openFeeBps: Number(v[0]),
    closeFeeBps: Number(v[1]),
    executionFee: fromWad(v[2]),
    maxLeverage: Number(v[3]),
    maintenanceBps: Number(v[4]),
    minCollateral: fromWad(v[5]),
  };
}

export function useImpactDepths(): number[] {
  const { data } = useReadContract({ ...contracts.perps, functionName: "getMarkets", query: { staleTime: 60_000 } });
  return data ? data.map((m) => fromWad(m.impactDepth)) : [];
}

export function useTusdBalance() {
  const { address } = useAccount();
  const q = useReadContract({
    ...contracts.tusd,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address), refetchInterval: 4_000 },
  });
  return { balance: fromWad(q.data), refetch: q.refetch };
}

export type LivePosition = {
  id: bigint;
  marketId: number;
  isLong: boolean;
  size: number;
  collateral: number;
  margin: number;
  entryPrice: number;
  tp: number;
  sl: number;
  openedAt: number;
  pnl: number;
  funding: number;
  equity: number;
  closeFee: number;
  liquidationPrice: number;
  liquidatable: boolean;
};

export function useMyPositions() {
  const { address } = useAccount();
  const list = useReadContract({
    ...contracts.perps,
    functionName: "getUserPositions",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address), refetchInterval: 3_000 },
  });
  const ids = list.data?.[0] ?? [];
  const status = useReadContract({
    ...contracts.perps,
    functionName: "positionStatuses",
    args: [ids],
    query: { enabled: ids.length > 0, refetchInterval: 2_000 },
  });
  const positions: LivePosition[] = (list.data?.[1] ?? []).map((p, i) => {
    const st = status.data?.[i];
    return {
      id: ids[i],
      marketId: p.marketId,
      isLong: p.isLong,
      size: fromWad(p.size),
      collateral: fromWad(p.collateral),
      margin: fromWad(p.margin),
      entryPrice: fromWad(p.entryPrice),
      tp: fromWad(p.tp),
      sl: fromWad(p.sl),
      openedAt: Number(p.openedAt) * 1000,
      pnl: fromWad(st?.pnl),
      funding: fromWad(st?.funding),
      equity: st ? fromWad(st.equity) : fromWad(p.margin),
      closeFee: fromWad(st?.closeFee),
      liquidationPrice: fromWad(st?.liquidationPrice),
      liquidatable: Boolean(st?.liquidatable),
    };
  });
  return { positions: positions.reverse(), isLoading: list.isLoading };
}

export function useMyOrders() {
  const { address } = useAccount();
  const q = useReadContract({
    ...contracts.perps,
    functionName: "getUserOrders",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address), refetchInterval: 3_000 },
  });
  const ids = q.data?.[0] ?? [];
  return (q.data?.[1] ?? [])
    .map((o, i) => ({
      id: ids[i],
      marketId: o.marketId,
      isLong: o.isLong,
      collateral: fromWad(o.collateral),
      size: fromWad(o.size),
      triggerPrice: fromWad(o.triggerPrice),
      tp: fromWad(o.tp),
      sl: fromWad(o.sl),
    }))
    .reverse();
}
