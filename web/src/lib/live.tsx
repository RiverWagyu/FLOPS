"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { KEEPER_URL } from "./config";
import { api, type KeeperStatus, type MarketState, type News, type PoolState, type Trade } from "./api";

type LiveEvent =
  | { type: "trade"; trade: Trade }
  | { type: "liquidation"; trade: Trade }
  | { type: "news"; news: News }
  | { type: "tick"; t: number; prices: number[] };

type Live = {
  markets: MarketState[];
  pool: PoolState | null;
  keeper: KeeperStatus | null;
  connected: boolean;
  lastTick: number;
  subscribe: (fn: (e: LiveEvent) => void) => () => void;
};

const LiveContext = createContext<Live | null>(null);

/** Streams prices, trades and news from the keeper's WebSocket. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const [markets, setMarkets] = useState<MarketState[]>([]);
  const [pool, setPool] = useState<PoolState | null>(null);
  const [keeper, setKeeper] = useState<KeeperStatus | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastTick, setLastTick] = useState(0);
  const listeners = useRef(new Set<(e: LiveEvent) => void>());
  const qc = useQueryClient();

  useEffect(() => {
    api<MarketState[]>("/api/markets").then(setMarkets).catch(() => {});
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout>;
    let closed = false;
    // Tell the keeper whether this tab is visible: it only posts prices on-chain every few
    // seconds while someone is actually looking, which keeps its gas bill small.
    const sendVisibility = () => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "visibility", visible: document.visibilityState === "visible" }));
      }
    };
    document.addEventListener("visibilitychange", sendVisibility);
    const connect = () => {
      ws = new WebSocket(KEEPER_URL.replace(/^http/, "ws") + "/ws");
      ws.onopen = () => {
        setConnected(true);
        sendVisibility();
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 2000);
      };
      ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        if (msg.markets) setMarkets(msg.markets);
        if (msg.pool) setPool(msg.pool);
        if (msg.keeper) setKeeper(msg.keeper);
        if (msg.type === "tick") setLastTick(msg.t);
        if (msg.type === "trade" || msg.type === "liquidation") {
          qc.invalidateQueries({ queryKey: ["trades"] });
          qc.invalidateQueries({ queryKey: ["history"] });
          qc.invalidateQueries({ queryKey: ["leaderboard"] });
        }
        if (msg.type !== "snapshot") listeners.current.forEach((fn) => fn(msg));
      };
    };
    connect();
    return () => {
      closed = true;
      document.removeEventListener("visibilitychange", sendVisibility);
      clearTimeout(retry);
      ws?.close();
    };
  }, [qc]);

  const subscribe = useCallback((fn: (e: LiveEvent) => void) => {
    listeners.current.add(fn);
    return () => void listeners.current.delete(fn);
  }, []);

  return (
    <LiveContext.Provider value={{ markets, pool, keeper, connected, lastTick, subscribe }}>{children}</LiveContext.Provider>
  );
}

export function useLive() {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error("useLive outside LiveProvider");
  return ctx;
}

export function useLiveEvent(fn: (e: LiveEvent) => void) {
  const { subscribe } = useLive();
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => subscribe((e) => ref.current(e)), [subscribe]);
}
