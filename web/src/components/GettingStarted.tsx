"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useQuery } from "@tanstack/react-query";
import { CHAIN, contracts } from "@/lib/config";
import { api, type History } from "@/lib/api";
import { useMyPositions, useTusdBalance } from "@/lib/hooks";
import { useExecute } from "@/lib/tx";

const STORE = "flops.guide"; // "done" once finished or dismissed
export const OPEN_GUIDE_EVENT = "flops:open-guide";

function load(): boolean {
  try {
    return localStorage.getItem(STORE) !== "done";
  } catch {
    return true;
  }
}
function save(done: boolean) {
  try {
    if (done) localStorage.setItem(STORE, "done");
    else localStorage.removeItem(STORE);
  } catch {
    /* storage unavailable: the guide just shows again next visit */
  }
}

/** Points the order panel out to the user: scrolls it into view and flashes its border. */
function showOrderPanel() {
  const el = document.getElementById("order-panel");
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("guide-highlight");
  setTimeout(() => el.classList.remove("guide-highlight"), 2400);
}

/**
 * First-visit checklist: connect a wallet, claim test tUSD, open a first trade.
 * Each step ticks itself off from live wallet and chain state, so it works no matter
 * where on the site the user does it. Dismissed for good once finished or skipped,
 * and reopened from the header's Guide button.
 */
export function GettingStarted() {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const path = usePathname();
  const { address, isConnected, chainId } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { balance } = useTusdBalance();
  const { positions } = useMyPositions();
  const execute = useExecute();
  const { data: history } = useQuery({
    queryKey: ["history", address],
    queryFn: () => api<History>(`/api/history?owner=${address}`),
    enabled: Boolean(address),
    refetchInterval: 10_000,
  });

  useEffect(() => {
    setOpen(load());
    const reopen = () => {
      save(false);
      setCollapsed(false);
      setOpen(true);
    };
    window.addEventListener(OPEN_GUIDE_EVENT, reopen);
    return () => window.removeEventListener(OPEN_GUIDE_EVENT, reopen);
  }, []);

  const wrongNetwork = isConnected && chainId !== CHAIN.id;
  const traded = positions.length > 0 || (history?.positions.length ?? 0) > 0;
  const done = [isConnected && !wrongNetwork, balance > 0 || traded, traded];
  const count = done.filter(Boolean).length;
  const current = done.findIndex((d) => !d); // -1 when everything is done
  const onTrade = path.startsWith("/trade");

  if (!open) return null;

  const close = () => {
    save(true);
    setOpen(false);
  };

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="fixed bottom-4 left-4 z-40 flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-2 text-xs shadow-lg hover:border-accent"
      >
        <Ring count={count} />
        Getting started · {count}/3
      </button>
    );
  }

  const steps = [
    {
      title: "Connect a wallet",
      body: wrongNetwork
        ? `Switch your wallet to ${CHAIN.name}.`
        : "Base Account trades with no gas fees. MetaMask works too, with a little test ETH for gas.",
      action: wrongNetwork ? null : (
        <StepButton onClick={() => openConnectModal?.()}>Connect wallet</StepButton>
      ),
    },
    {
      title: "Get free test money",
      body: "Claim 10,000 tUSD. It's a test token with no real value.",
      action: (
        <StepButton onClick={() => execute("Claim 10,000 tUSD", [{ ...contracts.tusd, functionName: "faucet" }])}>
          Claim 10,000 tUSD
        </StepButton>
      ),
    },
    {
      title: "Open your first trade",
      body: "Pick a GPU, choose Long (price goes up) or Short (price goes down), set an amount and leverage.",
      action: onTrade ? (
        <StepButton onClick={showOrderPanel}>Show me where</StepButton>
      ) : (
        <Link href="/trade/H100" className="inline-block rounded bg-accent px-2.5 py-1 text-xs font-medium text-white hover:brightness-110">
          Go to trading
        </Link>
      ),
    },
  ];

  return (
    <aside
      aria-label="Getting started"
      className="fixed bottom-4 left-4 z-40 w-[300px] max-w-[calc(100vw-2rem)] rounded-md border border-line bg-panel shadow-xl"
    >
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Ring count={count} />
          {current === -1 ? "You're all set" : "Getting started"}
        </div>
        <div className="flex items-center gap-1 text-muted">
          <button type="button" aria-label="Minimize" className="rounded px-1.5 hover:text-fg" onClick={() => setCollapsed(true)}>
            –
          </button>
          <button type="button" aria-label="Close guide" className="rounded px-1.5 hover:text-fg" onClick={close}>
            ×
          </button>
        </div>
      </div>

      {current === -1 ? (
        <div className="space-y-3 p-3 text-xs text-muted">
          <p>
            You've made your first trade. Track it under <span className="text-fg">Positions</span> below the chart, or see
            everything on the <Link href="/portfolio" className="text-fg underline">Portfolio</Link> page.
          </p>
          <p>
            Want to earn instead of trade? Add liquidity on the <Link href="/earn" className="text-fg underline">Earn</Link> page.
          </p>
          <StepButton onClick={close}>Done</StepButton>
        </div>
      ) : (
        <ol className="p-2">
          {steps.map((s, i) => {
            const isDone = done[i];
            const isCurrent = i === current;
            return (
              <li key={s.title} className={`flex gap-2.5 rounded p-2 ${isCurrent ? "bg-panel-2" : ""}`}>
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                    isDone ? "bg-long text-black" : isCurrent ? "bg-accent text-white" : "border border-line text-muted"
                  }`}
                  aria-hidden
                >
                  {isDone ? "✓" : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={`text-sm ${isDone ? "text-muted line-through" : "text-fg"}`}>{s.title}</div>
                  {isCurrent && (
                    <>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted">{s.body}</p>
                      {s.action && <div className="mt-2">{s.action}</div>}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {current !== -1 && (
        <div className="border-t border-line px-3 py-2 text-right">
          <button type="button" onClick={close} className="text-[11px] text-muted hover:text-fg">
            Skip guide
          </button>
        </div>
      )}
    </aside>
  );
}

function StepButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded bg-accent px-2.5 py-1 text-xs font-medium text-white hover:brightness-110"
    >
      {children}
    </button>
  );
}

/** Small progress ring: how many of the 3 steps are done. */
function Ring({ count }: { count: number }) {
  const r = 7;
  const c = 2 * Math.PI * r;
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <circle cx="9" cy="9" r={r} fill="none" stroke="var(--color-line)" strokeWidth="2.5" />
      <circle
        cx="9"
        cy="9"
        r={r}
        fill="none"
        stroke="var(--color-long)"
        strokeWidth="2.5"
        strokeDasharray={`${(c * count) / 3} ${c}`}
        strokeLinecap="round"
        transform="rotate(-90 9 9)"
      />
    </svg>
  );
}
