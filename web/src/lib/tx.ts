"use client";

import { useCallback } from "react";
import { useAccount, useConfig } from "wagmi";
import {
  getCapabilities,
  readContract,
  sendCalls,
  waitForCallsStatus,
  waitForTransactionReceipt,
  writeContract,
} from "wagmi/actions";
import { useQueryClient } from "@tanstack/react-query";
import { BaseError, ContractFunctionRevertedError, maxUint256, type Abi } from "viem";
import { CHAIN, contracts } from "./config";
import { useToast } from "@/components/Toasts";

export type Call = { address: `0x${string}`; abi: Abi; functionName: string; args?: readonly unknown[] };

let paymasterEnabled: Promise<boolean> | null = null;
function hasPaymaster() {
  paymasterEnabled ??= fetch("/api/paymaster")
    .then((r) => r.json())
    .then((j) => Boolean(j.enabled))
    .catch(() => false);
  return paymasterEnabled;
}

/**
 * Sends a list of contract calls.
 * - Smart wallets (EIP-5792): one atomic batch, gas sponsored by the paymaster when configured.
 * - Everything else: one transaction per call, in order.
 */
export function useExecute() {
  const config = useConfig();
  const { address } = useAccount();
  const qc = useQueryClient();
  const toast = useToast();

  return useCallback(
    async (label: string, calls: Call[], opts?: { spender?: `0x${string}`; amount?: bigint }) => {
      if (!address) throw new Error("Connect a wallet first");
      const id = toast.push({ kind: "pending", title: label, body: "Confirm in your wallet…" });
      try {
        // prepend an approval if this action spends tUSD
        if (opts?.spender && opts.amount && opts.amount > 0n) {
          const allowance = await readContract(config, {
            ...contracts.tusd,
            functionName: "allowance",
            args: [address, opts.spender],
          });
          if (allowance < opts.amount) {
            calls = [{ ...contracts.tusd, functionName: "approve", args: [opts.spender, maxUint256] }, ...calls];
          }
        }

        let caps: Record<string, any> | undefined;
        try {
          caps = (await getCapabilities(config, { account: address }))?.[CHAIN.id] as Record<string, any>;
        } catch {
          caps = undefined;
        }
        const atomic = caps?.atomic?.status === "supported" || caps?.atomic?.status === "ready" || caps?.atomicBatch?.supported;
        const sponsor = Boolean(caps?.paymasterService?.supported) && (await hasPaymaster());

        if (atomic || sponsor) {
          const { id: callsId } = await sendCalls(config, {
            calls: calls.map((c) => ({ to: c.address, abi: c.abi, functionName: c.functionName, args: c.args ?? [] })),
            capabilities: sponsor ? { paymasterService: { url: `${window.location.origin}/api/paymaster` } } : undefined,
          } as any);
          toast.update(id, { body: sponsor ? "Submitted (gas sponsored)…" : "Submitted…" });
          const res = await waitForCallsStatus(config, { id: callsId, timeout: 90_000 });
          if (res.status !== "success") throw new Error("Transaction failed");
        } else {
          for (let i = 0; i < calls.length; i++) {
            const c = calls[i];
            if (calls.length > 1) toast.update(id, { body: `Step ${i + 1} of ${calls.length}: confirm in wallet…` });
            const hash = await writeContract(config, { ...c, args: c.args ?? [] } as any);
            toast.update(id, { body: "Waiting for confirmation…" });
            const receipt = await waitForTransactionReceipt(config, { hash });
            if (receipt.status !== "success") throw new Error("Transaction reverted");
          }
        }
        toast.update(id, { kind: "success", body: "Confirmed" });
        qc.invalidateQueries();
        return true;
      } catch (e) {
        toast.update(id, { kind: "error", body: explain(e) });
        return false;
      }
    },
    [address, config, qc, toast],
  );
}

const REASONS: Record<string, string> = {
  StalePrice: "Price feed is stale — the keeper may be offline.",
  LeverageTooHigh: "Leverage is above the maximum.",
  LeverageTooLow: "Leverage must be at least 1x.",
  CollateralTooLow: "Collateral is below the minimum (10 tUSD).",
  PositionTooLarge: "Position is larger than 5% of the pool.",
  OpenInterestCap: "This side of the market is at its open-interest cap.",
  InvalidTpSl: "Take-profit / stop-loss is on the wrong side of the price.",
  EnforcedPause: "Trading is paused.",
  ERC20InsufficientBalance: "Not enough tUSD — claim some from the faucet.",
  ERC4626ExceededMaxWithdraw: "That much liquidity is backing open positions right now.",
};

function explain(e: unknown): string {
  if (e instanceof BaseError) {
    const revert = e.walk((err) => err instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    const name = revert?.data?.errorName;
    if (name) return REASONS[name] ?? name;
    if (/rejected|denied/i.test(e.message)) return "Rejected in wallet";
    return e.shortMessage;
  }
  return (e as Error)?.message ?? "Something went wrong";
}
